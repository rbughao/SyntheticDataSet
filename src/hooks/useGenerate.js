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
  // generateAll() — sequential multi-document orchestrator
  //
  // Processes every document in `documents` one after another.
  // Chunks within each document are processed in parallel (up to concurrency).
  //
  // Callbacks:
  //   onChunkPairs(pairs, docId)  — called as each chunk succeeds (streaming UI)
  //   onFileDone(docId, orderedPairs) — called when a file finishes with final
  //                                     document-order pairs (for ordered replace)
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

    let totalPairsCount = 0
    let firstError = null

    try {
      for (let fi = 0; fi < documents.length; fi++) {
        if (cancelRef.current || generationIdRef.current !== myId) break

        const doc = documents[fi]

        // Mark this file as 'processing' in the sidebar
        setFileProgress((prev) => ({
          ...prev,
          [doc.id]: { status: 'processing', pairCount: 0 },
        }))

        // Show initial progress for this file
        setProgress({
          fileIndex: fi,
          fileTotal: documents.length,
          fileName: doc.name,
          completed: 0,
          total: 1,
          pairsCount: totalPairsCount,
        })

        try {
          const orderedPairs = await processOneDocument({
            doc,
            settings,
            provider,
            onChunkPairs: (chunkPairs) => {
              if (generationIdRef.current !== myId) return
              // Tag each pair with its source document
              const tagged = chunkPairs.map((p) => ({ ...p, sourceDocId: doc.id }))
              totalPairsCount += tagged.length
              onChunkPairs?.(tagged, doc.id)
            },
            onProgress: ({ completed, total }) => {
              if (generationIdRef.current !== myId) return
              setProgress({
                fileIndex: fi,
                fileTotal: documents.length,
                fileName: doc.name,
                completed,
                total,
                pairsCount: totalPairsCount,
              })
            },
            cancelRef,
          })

          if (generationIdRef.current !== myId) break

          if (cancelRef.current) {
            // Cancelled mid-file — leave remaining as 'pending'
            setFileProgress((prev) => ({
              ...prev,
              [doc.id]: { status: 'pending', pairCount: 0 },
            }))
            break
          }

          // Tag ordered pairs and hand them to App for the atomic replace
          const taggedOrdered = orderedPairs.map((p) => ({ ...p, sourceDocId: doc.id }))
          setFileProgress((prev) => ({
            ...prev,
            [doc.id]: { status: 'done', pairCount: taggedOrdered.length },
          }))
          onFileDone?.(doc.id, taggedOrdered)
        } catch (err) {
          if (generationIdRef.current !== myId) break

          setFileProgress((prev) => ({
            ...prev,
            [doc.id]: { status: 'error', pairCount: 0 },
          }))

          if (documents.length === 1) {
            // Single-file run — surface the error in the workspace banner
            firstError = classifyError(err)
          } else {
            // Multi-file run — log and continue to the next file
            console.error(`File "${doc.name}" failed:`, err.message)
          }
        }
      }
    } finally {
      if (generationIdRef.current === myId) {
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
