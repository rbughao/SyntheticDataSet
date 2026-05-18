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
// processOneDocument — pure async helper (no React state)
// ---------------------------------------------------------------------------
/**
 * Runs the full chunked pipeline for a single document.
 * Does NOT touch React state — callers own all state transitions.
 *
 * @param {object} doc          Document object { id, name, text, … }
 * @param {object} settings     Generation settings
 * @param {object} provider     Already-created LLMProvider instance
 * @param {Function} onChunkPairs  (pairs[]) — called as each chunk succeeds
 * @param {Function} onProgress    ({ completed, total }) — called after each chunk settles
 * @param {{ current: boolean }} cancelRef
 * @returns {Promise<Array>}    Ordered pairs array (document order, not completion order)
 */
async function processOneDocument({ doc, settings, provider, onChunkPairs, onProgress, cancelRef }) {
  const fullText = doc.text
  const rawChunks = chunkDocument(fullText, CHUNK_SIZE, CHUNK_OVERLAP)
  const totalPairs = settings.pairCount
  const concurrency = Math.max(1, settings.concurrency || 3)

  const chunks = rawChunks.slice(0, Math.min(rawChunks.length, totalPairs))
  const n = chunks.length
  const basePairs = Math.floor(totalPairs / n)
  const extraPairs = totalPairs % n

  const chunkResults = new Array(n).fill(null)
  let completedCount = 0
  let failedCount = 0
  let lastFailError = null

  // Each task has an adaptive retry loop: context-size errors trigger halving
  // of chunk text and pair count (up to 3 halvings: 4000→2000→1000→500 chars).
  const MAX_CONTEXT_RETRIES = 3
  const taskFns = chunks.map((chunk, i) => async () => {
    const pairsForThisChunk = basePairs + (i < extraPairs ? 1 : 0)
    let chunkText = chunk.text
    let pairsToRequest = pairsForThisChunk

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
            `[chunk ${i + 1}/${n}] Context limit hit — retrying with ` +
            `${chunkText.length} chars, ${pairsToRequest} pair(s) ` +
            `(attempt ${attempt + 2}/${MAX_CONTEXT_RETRIES + 1})`
          )
          continue
        }
        throw err
      }
    }
  })

  await runConcurrent(
    taskFns,
    concurrency,
    (index, pairs, err) => {
      completedCount++
      if (pairs && pairs.length > 0) {
        chunkResults[index] = pairs
        onChunkPairs?.(pairs)
      } else {
        chunkResults[index] = []
        if (err) { failedCount++; lastFailError = err }
        console.warn(`Chunk ${index + 1}/${n} failed:`, err?.message)
      }
      onProgress?.({ completed: completedCount, total: n })
    },
    cancelRef
  )

  if (cancelRef?.current) return []

  if (failedCount > 0 && failedCount === n) {
    throw new Error(
      `All ${n} chunk${n !== 1 ? 's' : ''} failed. ` +
      `Last error: ${lastFailError?.message || 'unknown error'}`
    )
  }

  return chunkResults.flatMap((r) => r || [])
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

  const cancelRef = useRef(false)
  const generationIdRef = useRef(0)

  const clearError = useCallback(() => setError(null), [])
  const cancelGeneration = useCallback(() => { cancelRef.current = true }, [])

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

    // Initialise all documents as 'pending' in the sidebar
    setFileProgress(
      Object.fromEntries(documents.map((d) => [d.id, { status: 'pending', pairCount: 0 }]))
    )

    const provider = createProvider(settings.providerSlug, {
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      model: settings.model,
      proxyBaseUrl: settings.proxyBaseUrl,
      subProvider: settings.subProvider,
    })

    // ── Per-doc tracking ────────────────────────────────────────────────────
    const totalChunksPerDoc = {}  // { [docId]: number }
    const completedPerDoc = {}    // { [docId]: number } — success + failure count
    const failedPerDoc = {}       // { [docId]: number }
    const lastErrPerDoc = {}      // { [docId]: Error }
    const pairsByChunk = {}       // { [docId]: { [chunkIdx]: pair[] } }
    const docById = {}            // { [docId]: doc }

    // Parallel index maps so onItemDone can look up which doc/chunk a result belongs to
    const taskDocIds = []   // taskDocIds[taskIndex] = docId
    const taskChunkIs = []  // taskChunkIs[taskIndex] = chunkIndex within that doc

    let globalTotal = 0
    let globalCompleted = 0
    let globalPairs = 0
    let firstError = null

    const MAX_CONTEXT_RETRIES = 3

    // ── Flatten all chunks from all documents into one task array ───────────
    const allTaskFns = documents.flatMap((doc) => {
      const rawChunks = chunkDocument(doc.text, CHUNK_SIZE, CHUNK_OVERLAP)
      const totalPairs = settings.pairCount
      const chunks = rawChunks.slice(0, Math.min(rawChunks.length, totalPairs))
      const n = chunks.length
      const basePairs = Math.floor(totalPairs / n)
      const extraPairs = totalPairs % n

      docById[doc.id] = doc
      totalChunksPerDoc[doc.id] = n
      completedPerDoc[doc.id] = 0
      failedPerDoc[doc.id] = 0
      lastErrPerDoc[doc.id] = null
      pairsByChunk[doc.id] = {}
      globalTotal += n

      return chunks.map((chunk, i) => {
        taskDocIds.push(doc.id)
        taskChunkIs.push(i)
        const pairsForThisChunk = basePairs + (i < extraPairs ? 1 : 0)

        return async () => {
          let chunkText = chunk.text
          let pairsToRequest = pairsForThisChunk

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
                  `[${doc.name} chunk ${i + 1}/${n}] Context limit — retrying with ` +
                  `${chunkText.length} chars (attempt ${attempt + 2}/${MAX_CONTEXT_RETRIES + 1})`
                )
                continue
              }
              throw err
            }
          }
        }
      })
    })

    // ── Mark all docs as 'processing' — they all start concurrently ─────────
    setFileProgress(
      Object.fromEntries(documents.map((d) => [d.id, { status: 'processing', pairCount: 0 }]))
    )

    // ── Run all chunks through one shared pool ──────────────────────────────
    try {
      await runConcurrent(
        allTaskFns,
        Math.max(1, settings.concurrency || 3),
        (taskIndex, pairs, err) => {
          if (generationIdRef.current !== myId) return

          const docId = taskDocIds[taskIndex]
          const chunkIdx = taskChunkIs[taskIndex]
          const doc = docById[docId]
          const n = totalChunksPerDoc[docId]

          globalCompleted++

          if (pairs && pairs.length > 0) {
            pairsByChunk[docId][chunkIdx] = pairs
            const tagged = pairs.map((p) => ({ ...p, sourceDocId: docId }))
            globalPairs += tagged.length
            onChunkPairs?.(tagged, docId)
          } else {
            pairsByChunk[docId][chunkIdx] = []
            if (err) {
              failedPerDoc[docId]++
              lastErrPerDoc[docId] = err
              console.warn(`[${doc.name} chunk ${chunkIdx + 1}/${n}] failed:`, err.message)
            }
          }

          completedPerDoc[docId]++

          // Update global progress bar
          setProgress({
            fileTotal: documents.length,
            completed: globalCompleted,
            total: globalTotal,
            pairsCount: globalPairs,
          })

          // When every chunk for this doc has settled → finalise it
          if (completedPerDoc[docId] === n) {
            const allFailed = failedPerDoc[docId] === n
            if (allFailed) {
              setFileProgress((prev) => ({
                ...prev,
                [docId]: { status: 'error', pairCount: 0 },
              }))
              const docErr = new Error(
                `All ${n} chunk${n !== 1 ? 's' : ''} failed. ` +
                `Last error: ${lastErrPerDoc[docId]?.message || 'unknown error'}`
              )
              if (documents.length === 1) {
                firstError = classifyError(docErr)
              } else {
                console.error(`File "${doc.name}" failed:`, docErr.message)
              }
            } else {
              // Reconstruct pairs in document-text order (not completion order)
              const orderedPairs = Array.from({ length: n }, (_, i) =>
                pairsByChunk[docId][i] || []
              ).flat()
              const taggedOrdered = orderedPairs.map((p) => ({ ...p, sourceDocId: docId }))
              setFileProgress((prev) => ({
                ...prev,
                [docId]: { status: 'done', pairCount: taggedOrdered.length },
              }))
              onFileDone?.(docId, taggedOrdered)
            }
          }
        },
        cancelRef
      )
    } finally {
      if (generationIdRef.current === myId) {
        // Reset any docs still showing 'processing' (cancelled before completion)
        setFileProgress((prev) => {
          const updated = { ...prev }
          for (const doc of documents) {
            if (updated[doc.id]?.status === 'processing') {
              updated[doc.id] = { status: 'pending', pairCount: 0 }
            }
          }
          return updated
        })
        setIsLoading(false)
        setProgress(null)
        if (firstError) setError(firstError)
      }
    }
  }, [])

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

    const provider = createProvider(settings.providerSlug, {
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      model: settings.model,
      proxyBaseUrl: settings.proxyBaseUrl,
      subProvider: settings.subProvider,
    })

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
    isLoading,
    progress,
    fileProgress,
    error,
    clearError,
    cancelGeneration,
  }
}
