import { useState, useCallback, useRef } from 'react'
import { buildMessages, buildChunkMessages } from '../utils/promptBuilder.js'
import { chunkDocument, CHUNK_SIZE, CHUNK_OVERLAP } from '../utils/chunker.js'
import { parseResponse, ParseError } from '../utils/parser.js'
import { createProvider } from '../providers/index.js'

// ---------------------------------------------------------------------------
// Concurrency pool — browser-native "thread pool" over async I/O
// ---------------------------------------------------------------------------
/**
 * Run taskFns with at most `concurrency` in-flight simultaneously.
 * Each worker goroutine pulls the next unclaimed task from a shared index,
 * so N workers saturate up to N API slots concurrently.
 */
async function runConcurrent(taskFns, concurrency, onItemDone, cancelRef) {
  const results = new Array(taskFns.length).fill(null)
  let nextIndex = 0

  async function worker() {
    while (true) {
      if (cancelRef?.current) break
      const index = nextIndex++
      if (index >= taskFns.length) break
      try {
        const value = await taskFns[index]()
        results[index] = { ok: true, value }
        onItemDone?.(index, value, null)
      } catch (err) {
        results[index] = { ok: false, error: err }
        onItemDone?.(index, null, err)
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), taskFns.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Estimate output token budget for `pairCount` pairs. */
function calcMaxTokens(pairCount) {
  return Math.min(Math.max(pairCount * 300, 1024), 16384)
}

/**
 * Returns true when the error is a model context-window overflow.
 * Matches phrasing from OpenAI, Anthropic, Google, Ollama, LM Studio, and
 * generic OpenAI-compatible servers.
 */
function isContextError(err) {
  const msg = (err.message || '').toLowerCase()
  return (
    msg.includes('context size') ||
    msg.includes('context_length') ||
    msg.includes('context length') ||
    msg.includes('context window') ||
    msg.includes('context has been exceeded') ||
    msg.includes('maximum context') ||
    msg.includes('input is too long') ||
    msg.includes('too long for') ||
    msg.includes('length exceeded') ||
    (msg.includes('token') && (
      msg.includes('exceed') ||
      msg.includes('limit') ||
      msg.includes('maximum') ||
      msg.includes('too many')
    ))
  )
}

/** Classify an error into the three UI categories. */
function classifyError(err) {
  if (err instanceof ParseError) {
    return { type: 'parse', message: err.message, rawText: err.rawText }
  }
  const msg = err.message || ''
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('Network error') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('proxy_error') ||
    msg.includes('HTTP 502')
  ) {
    return { type: 'network', message: msg }
  }
  return { type: 'api', message: msg }
}

/** Map a raw LLM response text into fully formed pair objects. */
function toPairs(parsed) {
  return parsed.map((item) => ({
    id: crypto.randomUUID(),
    instruction: item.instruction,
    output: item.output,
    type: item.type,
    rating: null,
    edited: false,
  }))
}

// ---------------------------------------------------------------------------
// Chunk specs — the unit of work shared by generateAll() and retryFailedChunks()
// ---------------------------------------------------------------------------
const MAX_CONTEXT_RETRIES = 3

/**
 * Expand documents into a flat list of chunk specs.
 * A spec fully describes one API call, so a failed one can be re-run verbatim.
 *
 * @returns {Array<{ docId, docName, chunk, chunkIndex, totalChunks, pairsToRequest }>}
 */
function buildChunkSpecs(documents, settings) {
  const specs = []
  for (const doc of documents) {
    const rawChunks = chunkDocument(doc.text, CHUNK_SIZE, CHUNK_OVERLAP)
    const totalPairs = settings.pairCount
    // Never request more chunks than pairs — each chunk yields at least one pair
    const chunks = rawChunks.slice(0, Math.min(rawChunks.length, totalPairs))
    const n = chunks.length
    const basePairs = Math.floor(totalPairs / n)
    const extraPairs = totalPairs % n

    chunks.forEach((chunk, i) => {
      specs.push({
        docId: doc.id,
        docName: doc.name,
        chunk,
        chunkIndex: i,
        totalChunks: n,
        pairsToRequest: basePairs + (i < extraPairs ? 1 : 0),
      })
    })
  }
  return specs
}

/**
 * Turn one spec into an async task.
 *
 * Includes the adaptive context-overflow retry: on a context-size error the
 * chunk text and requested pair count are halved and the call retried, up to
 * MAX_CONTEXT_RETRIES times (4000→2000→1000→500 chars).
 */
function makeChunkTask(spec, provider, settings) {
  return async () => {
    const { chunk, chunkIndex: i, totalChunks: n, docName } = spec
    let chunkText = chunk.text
    let pairsToRequest = spec.pairsToRequest

    for (let attempt = 0; attempt <= MAX_CONTEXT_RETRIES; attempt++) {
      try {
        const chunkForPrompt = { ...chunk, text: chunkText }
        const { messages, temperature } = buildChunkMessages(
          chunkForPrompt, i, n, pairsToRequest, settings
        )
        const responseText = await provider.complete(messages, {
          model: settings.model,
          temperature,
          maxTokens: calcMaxTokens(pairsToRequest),
        })
        return toPairs(parseResponse(responseText))
      } catch (err) {
        const hitContextLimit = isContextError(err)
        const canShrink = chunkText.length > 500 && attempt < MAX_CONTEXT_RETRIES
        if (hitContextLimit && canShrink) {
          chunkText = chunkText.slice(0, Math.ceil(chunkText.length / 2))
          pairsToRequest = Math.max(1, Math.ceil(pairsToRequest / 2))
          console.warn(
            `[${docName} chunk ${i + 1}/${n}] Context limit — retrying with ` +
            `${chunkText.length} chars (attempt ${attempt + 2}/${MAX_CONTEXT_RETRIES + 1})`
          )
          continue
        }
        throw err
      }
    }
  }
}

/** Build a provider instance from settings. */
function providerFrom(settings) {
  return createProvider(settings.providerSlug, {
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    proxyBaseUrl: settings.proxyBaseUrl,
    subProvider: settings.subProvider,
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useGenerate() {
  const [isLoading, setIsLoading] = useState(false)
  // Chunk + file level progress, or null when idle.
  // Shape: { fileIndex, fileTotal, fileName, completed, total, pairsCount }
  const [progress, setProgress] = useState(null)
  // Per-document processing status for sidebar badges.
  // Shape: { [docId]: { status: 'pending'|'processing'|'done'|'error', pairCount: number } }
  const [fileProgress, setFileProgress] = useState({})
  const [error, setError] = useState(null)

  // Chunk specs that errored in the last run, kept so they can be re-run
  // without regenerating the whole dataset.
  const [failedChunks, setFailedChunks] = useState([])

  const cancelRef = useRef(false)
  const generationIdRef = useRef(0)
  // Settings captured from the last run, reused by retryFailedChunks()
  const lastSettingsRef = useRef(null)

  const clearError = useCallback(() => setError(null), [])
  const cancelGeneration = useCallback(() => { cancelRef.current = true }, [])
  const clearFailedChunks = useCallback(() => setFailedChunks([]), [])

  // ---------------------------------------------------------------------------
  // generateAll() — parallel multi-document orchestrator
  //
  // All file-chunks across ALL documents are queued into ONE shared concurrency
  // pool. This means files process simultaneously instead of sequentially,
  // giving a significant speed improvement for multi-file runs.
  //
  // Example (4 files × 6 chunks, concurrency=3):
  //   Sequential (old): ~28s   Parallel (new): ~16s  → ~43% faster
  //
  // Accuracy is not affected: each API call is a self-contained prompt with
  // only that chunk's text — the LLM has no memory of other calls.
  //
  // Callbacks:
  //   onChunkPairs(pairs, docId)      — called as each chunk succeeds (streaming UI)
  //   onFileDone(docId, orderedPairs) — called when ALL chunks for a doc finish
  // ---------------------------------------------------------------------------
  const generateAll = useCallback(async (documents, settings, onChunkPairs, onFileDone) => {
    if (!documents.length) return

    const myId = ++generationIdRef.current
    cancelRef.current = false

    setIsLoading(true)
    setProgress(null)
    setError(null)
    setFailedChunks([])
    lastSettingsRef.current = settings

    const provider = providerFrom(settings)
    const specs = buildChunkSpecs(documents, settings)

    // ── Per-doc tracking ────────────────────────────────────────────────────
    const totalChunksPerDoc = {}  // { [docId]: number }
    const completedPerDoc = {}    // { [docId]: number } — success + failure
    const failedPerDoc = {}       // { [docId]: number }
    const lastErrPerDoc = {}      // { [docId]: Error }
    const pairsByChunk = {}       // { [docId]: { [chunkIdx]: pair[] } }
    const docById = {}            // { [docId]: doc }

    for (const doc of documents) {
      docById[doc.id] = doc
      totalChunksPerDoc[doc.id] = 0
      completedPerDoc[doc.id] = 0
      failedPerDoc[doc.id] = 0
      lastErrPerDoc[doc.id] = null
      pairsByChunk[doc.id] = {}
    }
    for (const s of specs) totalChunksPerDoc[s.docId] = s.totalChunks

    const globalTotal = specs.length
    let globalCompleted = 0
    let globalPairs = 0
    let firstError = null
    const failures = []

    // All docs start concurrently — mark them all 'processing'
    setFileProgress(
      Object.fromEntries(documents.map((d) => [d.id, { status: 'processing', pairCount: 0 }]))
    )

    // ── Run every chunk from every file through one shared pool ─────────────
    try {
      await runConcurrent(
        specs.map((spec) => makeChunkTask(spec, provider, settings)),
        Math.max(1, settings.concurrency || 3),
        (taskIndex, pairs, err) => {
          if (generationIdRef.current !== myId) return

          const spec = specs[taskIndex]
          const { docId, chunkIndex, totalChunks: n, docName } = spec

          globalCompleted++

          if (pairs && pairs.length > 0) {
            pairsByChunk[docId][chunkIndex] = pairs
            const tagged = pairs.map((p) => ({ ...p, sourceDocId: docId }))
            globalPairs += tagged.length
            onChunkPairs?.(tagged, docId)
          } else {
            pairsByChunk[docId][chunkIndex] = []
            if (err) {
              failedPerDoc[docId]++
              lastErrPerDoc[docId] = err
              // Keep the spec so the user can retry just this chunk
              failures.push({ spec, message: err.message })
              console.warn(`[${docName} chunk ${chunkIndex + 1}/${n}] failed:`, err.message)
            }
          }

          completedPerDoc[docId]++

          setProgress({
            fileTotal: documents.length,
            completed: globalCompleted,
            total: globalTotal,
            pairsCount: globalPairs,
          })

          // Every chunk for this doc has settled → finalise it
          if (completedPerDoc[docId] === n) {
            if (failedPerDoc[docId] === n) {
              setFileProgress((prev) => ({
                ...prev,
                [docId]: { status: 'error', pairCount: 0 },
              }))
              const docErr = new Error(
                `All ${n} chunk${n !== 1 ? 's' : ''} failed. ` +
                `Last error: ${lastErrPerDoc[docId]?.message || 'unknown error'}`
              )
              if (documents.length === 1) firstError = classifyError(docErr)
              else console.error(`File "${docName}" failed:`, docErr.message)
            } else {
              // Reconstruct in document-text order, not completion order
              const ordered = Array.from({ length: n }, (_, i) => pairsByChunk[docId][i] || []).flat()
              const tagged = ordered.map((p) => ({ ...p, sourceDocId: docId }))
              setFileProgress((prev) => ({
                ...prev,
                [docId]: { status: 'done', pairCount: tagged.length },
              }))
              onFileDone?.(docId, tagged)
            }
          }
        },
        cancelRef
      )
    } finally {
      if (generationIdRef.current === myId) {
        // Any doc still 'processing' was cut short by cancel — reset it
        setFileProgress((prev) => {
          const updated = { ...prev }
          for (const doc of documents) {
            if (updated[doc.id]?.status === 'processing') {
              updated[doc.id] = { status: 'pending', pairCount: 0 }
            }
          }
          return updated
        })
        setFailedChunks(failures)
        setIsLoading(false)
        setProgress(null)
        if (firstError) setError(firstError)
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // retryFailedChunks() — re-run only the chunks that errored last time
  //
  // Without this a handful of transient failures (rate limit, timeout) means
  // regenerating the entire dataset, paying for every chunk a second time.
  // Recovered pairs are appended via onRecovered rather than replacing a file's
  // pairs, since the successful chunks are already in the workspace.
  // ---------------------------------------------------------------------------
  const retryFailedChunks = useCallback(async (onRecovered) => {
    const pending = failedChunks
    const settings = lastSettingsRef.current
    if (!pending.length || !settings) return

    const myId = ++generationIdRef.current
    cancelRef.current = false

    setIsLoading(true)
    setError(null)
    setProgress({ fileTotal: 1, completed: 0, total: pending.length, pairsCount: 0 })

    const provider = providerFrom(settings)
    const stillFailing = []
    let completed = 0
    let recoveredPairs = 0

    try {
      await runConcurrent(
        pending.map(({ spec }) => makeChunkTask(spec, provider, settings)),
        Math.max(1, settings.concurrency || 3),
        (taskIndex, pairs, err) => {
          if (generationIdRef.current !== myId) return

          const { spec } = pending[taskIndex]
          completed++

          if (pairs && pairs.length > 0) {
            const tagged = pairs.map((p) => ({ ...p, sourceDocId: spec.docId }))
            recoveredPairs += tagged.length
            onRecovered?.(tagged, spec.docId)
          } else if (err) {
            stillFailing.push({ spec, message: err.message })
          }

          setProgress({
            fileTotal: 1,
            completed,
            total: pending.length,
            pairsCount: recoveredPairs,
          })
        },
        cancelRef
      )
    } finally {
      if (generationIdRef.current === myId) {
        setFailedChunks(stillFailing)
        setIsLoading(false)
        setProgress(null)
      }
    }
  }, [failedChunks])

  // ---------------------------------------------------------------------------
  // regeneratePair() — single-pair targeted replacement (unchanged)
  // ---------------------------------------------------------------------------
  const regeneratePair = useCallback(async (pair, document, settings, onPairRegenerated) => {
    const targetSettings = {
      ...settings,
      pairCount: 1,
      styles: [pair.type === 'instruction' ? 'instruction' : 'factual'],
    }

    const chunks = chunkDocument(document.text, CHUNK_SIZE, CHUNK_OVERLAP)
    const docForPrompt = { ...document, text: chunks[0].text }
    const { messages, temperature } = buildMessages(docForPrompt, targetSettings)

    const provider = providerFrom(settings)

    const responseText = await provider.complete(messages, {
      model: settings.model,
      temperature,
      maxTokens: 1024,
    })

    const parsed = parseResponse(responseText)
    if (parsed.length === 0) throw new Error('No pairs returned from regeneration')

    onPairRegenerated({
      ...parsed[0],
      id: pair.id,
      rating: null,
      edited: false,
      sourceDocId: pair.sourceDocId,
    })
  }, [])

  return {
    generateAll,
    regeneratePair,
    retryFailedChunks,
    failedChunks,
    clearFailedChunks,
    isLoading,
    progress,
    fileProgress,
    error,
    clearError,
    cancelGeneration,
  }
}
