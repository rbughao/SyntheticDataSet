import { useState, useCallback, useRef } from 'react'
import { buildMessages, buildChunkMessages } from '../utils/promptBuilder.js'
import { chunkDocument, CHUNK_SIZE, CHUNK_OVERLAP } from '../utils/chunker.js'
import { parseResponse, ParseError } from '../utils/parser.js'
import { createProvider } from '../providers/index.js'

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------
/**
 * Run an array of async task factories with at most `concurrency` in-flight
 * simultaneously. This is the browser-native equivalent of a thread pool —
 * JavaScript is single-threaded, but concurrent Promises allow N network
 * requests to be in-flight at the same time (each awaiting its own I/O).
 *
 * @param {Array<() => Promise<any>>} taskFns  Factory functions, one per chunk
 * @param {number}                    concurrency  Max simultaneous in-flight tasks
 * @param {Function}                  onItemDone  Called as (index, value | null, error | null)
 * @param {{ current: boolean }}      cancelRef   Set .current = true to stop queueing new tasks
 * @returns {Promise<Array<{ ok: boolean, value?, error? }>>}  Indexed by original position
 */
async function runConcurrent(taskFns, concurrency, onItemDone, cancelRef) {
  const results = new Array(taskFns.length).fill(null)
  let nextIndex = 0

  // Each "worker" goroutine pulls the next unprocessed task from the shared queue.
  // Multiple workers run concurrently, saturating up to `concurrency` API slots.
  async function worker() {
    while (true) {
      // Check cancellation before pulling next task
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
  // Launch all workers simultaneously — they compete for the shared queue
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

// ---------------------------------------------------------------------------
// Token budget helper
// ---------------------------------------------------------------------------
/** Estimate how many output tokens `pairCount` pairs might need. */
function calcMaxTokens(pairCount) {
  // ~300 tokens per pair (generous), minimum 1024, capped at 16384
  return Math.min(Math.max(pairCount * 300, 1024), 16384)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useGenerate() {
  const [isLoading, setIsLoading] = useState(false)
  // progress: { completed: number, total: number, pairsCount: number } | null
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const cancelRef = useRef(false)

  const clearError = useCallback(() => setError(null), [])

  /** Signal the concurrency pool to stop accepting new tasks after the current batch. */
  const cancelGeneration = useCallback(() => {
    cancelRef.current = true
  }, [])

  // ---------------------------------------------------------------------------
  // generate() — bulk generation with chunking + parallel requests
  // ---------------------------------------------------------------------------
  /**
   * @param document        Active document (full .text is used — no pre-truncation)
   * @param settings        Current settings incl. pairCount, concurrency, providerSlug, etc.
   * @param onPairsReceived Called once at the end with the final ordered array of all pairs
   * @param onChunkDone     Called after each chunk with that chunk's pairs — use for live streaming
   */
  const generate = useCallback(async (document, settings, onPairsReceived, onChunkDone) => {
    if (!document) return
    setIsLoading(true)
    setProgress(null)
    setError(null)
    cancelRef.current = false

    try {
      const fullText = document.text
      const chunks = chunkDocument(fullText, CHUNK_SIZE, CHUNK_OVERLAP)
      const totalChunks = chunks.length
      const concurrency = Math.max(1, settings.concurrency || 3)

      const provider = createProvider(settings.providerSlug, {
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        model: settings.model,
        proxyBaseUrl: settings.proxyBaseUrl,
        subProvider: settings.subProvider,
      })

      // ── Single-chunk fast path (small docs) ──────────────────────────────
      if (totalChunks === 1) {
        setProgress({ completed: 0, total: 1, pairsCount: 0 })
        const { messages, temperature } = buildMessages(
          { ...document, text: chunks[0].text },
          settings
        )
        const responseText = await provider.complete(messages, {
          model: settings.model,
          temperature,
          maxTokens: calcMaxTokens(settings.pairCount),
        })
        const parsed = parseResponse(responseText)
        const newPairs = parsed.map((item) => ({
          id: crypto.randomUUID(),
          instruction: item.instruction,
          output: item.output,
          type: item.type,
          rating: null,
          edited: false,
        }))
        setProgress({ completed: 1, total: 1, pairsCount: newPairs.length })
        onPairsReceived(newPairs)
        return
      }

      // ── Multi-chunk concurrent path ───────────────────────────────────────
      const totalPairs = settings.pairCount
      // Pre-calculate pairs per chunk so all tasks are independent (no shared mutable counter)
      const pairsPerChunk = Math.max(1, Math.round(totalPairs / totalChunks))
      // Last chunk gets the remainder to hit the exact total
      const pairsForLastChunk = Math.max(1, totalPairs - pairsPerChunk * (totalChunks - 1))

      // Results array indexed by chunk position — preserves document order
      const chunkResults = new Array(totalChunks).fill(null)
      let completedCount = 0
      let streamedPairsCount = 0

      setProgress({ completed: 0, total: totalChunks, pairsCount: 0 })

      // Build one task factory per chunk — closures capture `i` correctly
      const taskFns = chunks.map((chunk, i) => async () => {
        const isLast = i === totalChunks - 1
        const pairsForThisChunk = isLast ? pairsForLastChunk : pairsPerChunk

        const { messages, temperature } = buildChunkMessages(
          chunk, i, totalChunks, pairsForThisChunk, settings
        )

        const responseText = await provider.complete(messages, {
          model: settings.model,
          temperature,
          maxTokens: calcMaxTokens(pairsForThisChunk),
        })

        const parsed = parseResponse(responseText)
        return parsed.map((item) => ({
          id: crypto.randomUUID(),
          instruction: item.instruction,
          output: item.output,
          type: item.type,
          rating: null,
          edited: false,
        }))
      })

      await runConcurrent(
        taskFns,
        concurrency,
        (index, pairs, err) => {
          completedCount++
          if (pairs && pairs.length > 0) {
            chunkResults[index] = pairs
            streamedPairsCount += pairs.length
            // Stream chunk pairs to the workspace as they arrive (completion order)
            onChunkDone?.(pairs)
          } else {
            // Chunk failed — treat as empty, log, keep going
            chunkResults[index] = []
            if (err) {
              console.warn(`Chunk ${index + 1}/${totalChunks} failed:`, err.message)
            }
          }
          setProgress({
            completed: completedCount,
            total: totalChunks,
            pairsCount: streamedPairsCount,
          })
        },
        cancelRef
      )

      // Flatten in document order (chunk index, not completion order)
      const allPairs = chunkResults.flatMap((r) => r || [])
      onPairsReceived(allPairs)
    } catch (err) {
      if (err instanceof ParseError) {
        setError({ type: 'parse', message: err.message, rawText: err.rawText })
      } else if (
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('Network error')
      ) {
        setError({ type: 'network', message: err.message })
      } else {
        setError({ type: 'api', message: err.message })
      }
    } finally {
      setIsLoading(false)
      setProgress(null)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // regeneratePair() — single-pair targeted regeneration (unchanged flow)
  // ---------------------------------------------------------------------------
  const regeneratePair = useCallback(async (pair, document, settings, onPairRegenerated) => {
    const targetSettings = {
      ...settings,
      pairCount: 1,
      styles: [pair.type === 'instruction' ? 'instruction' : 'factual'],
    }

    // For single-pair regeneration, use just the first chunk for focused context
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
      id: pair.id, // keep same ID so the card stays in place
      rating: null,
      edited: false,
    })
  }, [])

  return {
    generate,
    regeneratePair,
    isLoading,
    progress,
    error,
    clearError,
    cancelGeneration,
  }
}
