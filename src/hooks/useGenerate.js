import { useState, useCallback } from 'react'
import { buildMessages } from '../utils/promptBuilder.js'
import { parseResponse, ParseError } from '../utils/parser.js'
import { createProvider } from '../providers/index.js'

const MAX_DOC_CHARS = 6000

function prepareDocText(document) {
  if (!document) return ''
  const text = document.autoTruncate
    ? document.text.slice(0, MAX_DOC_CHARS)
    : document.text
  return text
}

/**
 * Core generation hook. Keeps loading/error state and exposes
 * `generate` (bulk) and `regeneratePair` (single pair) functions.
 */
export function useGenerate() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null) // { type, message, rawText? }

  const clearError = useCallback(() => setError(null), [])

  /**
   * Generate a batch of pairs from a document using the current settings.
   * Calls onPairsReceived(newPairs) when done.
   */
  const generate = useCallback(async (document, settings, onPairsReceived) => {
    if (!document) return
    setIsLoading(true)
    setError(null)

    try {
      const docForPrompt = { ...document, text: prepareDocText(document) }
      const { messages, temperature } = buildMessages(docForPrompt, settings)

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

      onPairsReceived(newPairs)
    } catch (err) {
      if (err instanceof ParseError) {
        setError({ type: 'parse', message: err.message, rawText: err.rawText })
      } else if (err.message?.includes('Failed to fetch') || err.message?.includes('Network error')) {
        setError({ type: 'network', message: err.message })
      } else {
        setError({ type: 'api', message: err.message })
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Regenerate a single existing pair. Sends a targeted prompt requesting
   * exactly 1 pair of the same type.
   */
  const regeneratePair = useCallback(async (pair, document, settings, onPairRegenerated) => {
    const docForPrompt = { ...document, text: prepareDocText(document) }

    // Override pair count and styles to target just this pair's type
    const targetSettings = {
      ...settings,
      pairCount: 1,
      styles: [pair.type === 'instruction' ? 'instruction' : 'factual'],
    }

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
    })

    const parsed = parseResponse(responseText)
    if (parsed.length === 0) throw new Error('No pairs returned from regeneration')

    onPairRegenerated({
      ...parsed[0],
      id: pair.id, // keep the same ID so the card stays in place
      rating: null,
      edited: false,
    })
  }, [])

  return { generate, regeneratePair, isLoading, error, clearError }
}
