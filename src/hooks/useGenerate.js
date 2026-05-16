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
 *
 * @param {Array<() => Promise<any>>} taskFns
 * @param {number}  concurrency  Max simultaneous in-flight requests
 * @param {Function} onItemDone  (index, value|null, error|null) — called as each task settles
 * @param {{ current: boolean }} cancelRef  Set .current=true to stop queuing new tasks
 * @returns {Promise<Array<{ ok, value?, error? }>>}  Indexed by original task position
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
// Hook
// ---------------------------------------------------------------------------
export function useGenerate() {
  const [isLoading, setIsLoading] = useState(false)
  // { completed: number, total: number, pairsCount: number } | null
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  // cancelRef: set to true by cancelGeneration() to stop queuing new chunks.
  const cancelRef = useRef(false)

  // generationIdRef: incremented at the start of every generate() call.
  // Any async callback that sees a stale ID (from a previous or superseded
  // run) discards its work silently, preventing race conditions when the user
  // clicks Generate again before the previous run finishes.
  const generationIdRef = useRef(0)

  const clearError = useCallback(() => setError(null), [])

  const cancelGeneration = useCallback(() => {
    cancelRef.current = true
  }, [])

  // ---------------------------------------------------------------------------
  // generate() — chunked, parallel generation
  // ---------------------------------------------------------------------------
  const generate = useCallback(async (document, settings, onPairsReceived, onChunkDone) => {
    if (!document) return

    // Claim a unique generation ID before any awaits (avoids reset race)
    const myId = ++generationIdRef.current
    cancelRef.current = false

    setIsLoading(true)
    setProgress(null)
    setError(null)

    try {
      const fullText = document.text
      const rawChunks = chunkDocument(fullText, CHUNK_SIZE, CHUNK_OVERLAP)
      const totalPairs = settings.pairCount
      const concurrency = Math.max(1, settings.concurrency || 3)

      // Never request 0 pairs from a chunk: cap active chunks to totalPairs.
      // This also guarantees basePairs >= 1.
      const chunks = rawChunks.slice(0, Math.min(rawChunks.length, totalPairs))
      const n = chunks.length

      // Distribute pairs evenly: each chunk gets basePairs, and the first
      // extraPairs chunks each get one extra, summing to exactly totalPairs.
      const basePairs = Math.floor(totalPairs / n)
      const extraPairs = totalPairs % n

      const provider = createProvider(settings.providerSlug, {
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        model: settings.model,
        proxyBaseUrl: settings.proxyBaseUrl,
        subProvider: settings.subProvider,
      })

      // Results array indexed by chunk position — preserves document order
      // regardless of which chunk finishes first.
      const chunkResults = new Array(n).fill(null)
      let completedCount = 0
      let streamedPairsCount = 0
      let failedCount = 0
      let lastFailError = null

      setProgress({ completed: 0, total: n, pairsCount: 0 })

      // Build one async task per chunk (closures capture `i` correctly via `map`)
      const taskFns = chunks.map((chunk, i) => async () => {
        const pairsForThisChunk = basePairs + (i < extraPairs ? 1 : 0)
        // Use buildChunkMessages for ALL chunks (single or multi) so the prompt
        // format and behaviour are identical regardless of document size.
        const { messages, temperature } = buildChunkMessages(
          chunk, i, n, pairsForThisChunk, settings
        )
        const responseText = await provider.complete(messages, {
          model: settings.model,
          temperature,
          maxTokens: calcMaxTokens(pairsForThisChunk),
        })
        return toPairs(parseResponse(responseText))
      })

      await runConcurrent(
        taskFns,
        concurrency,
        (index, pairs, err) => {
          // Discard callbacks from superseded runs
          if (generationIdRef.current !== myId) return

          completedCount++
          if (pairs && pairs.length > 0) {
            chunkResults[index] = pairs
            streamedPairsCount += pairs.length
            // Stream chunk pairs to the workspace as they arrive (completion order)
            onChunkDone?.(pairs)
          } else {
            chunkResults[index] = []
            if (err) { failedCount++; lastFailError = err }
            console.warn(`Chunk ${index + 1}/${n} failed:`, err?.message)
          }
          setProgress({ completed: completedCount, total: n, pairsCount: streamedPairsCount })
        },
        cancelRef
      )

      // Bail out if this run was superseded by a newer Generate call
      if (generationIdRef.current !== myId) return

      // Bail out if cancelled — keep whatever pairs streamed via onChunkDone
      if (cancelRef.current) return

      // C-2 fix: surface an error when every chunk failed instead of silently
      // returning 0 pairs with no feedback.
      if (failedCount > 0 && failedCount === n) {
        throw new Error(
          `All ${n} chunk${n !== 1 ? 's' : ''} failed. ` +
          `Last error: ${lastFailError?.message || 'unknown error'}`
        )
      }

      // Final ordered result (chunk index order, not completion order)
      const allPairs = chunkResults.flatMap((r) => r || [])
      onPairsReceived(allPairs)
    } catch (err) {
      // Discard errors from superseded runs
      if (generationIdRef.current !== myId) return

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
      // Only this run should reset loading state — a superseding run owns isLoading
      if (generationIdRef.current === myId) {
        setIsLoading(false)
        setProgress(null)
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // regeneratePair() — single-pair targeted replacement (unchanged flow)
  // ---------------------------------------------------------------------------
  const regeneratePair = useCallback(async (pair, document, settings, onPairRegenerated) => {
    const targetSettings = {
      ...settings,
      pairCount: 1,
      styles: [pair.type === 'instruction' ? 'instruction' : 'factual'],
    }

    // For single-pair regeneration, use the first chunk for focused context
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
