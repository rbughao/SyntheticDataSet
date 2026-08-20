import { chunkDocument, CHUNK_SIZE, CHUNK_OVERLAP } from './chunker.js'

// ---------------------------------------------------------------------------
// Model pricing table — USD per 1 million tokens
//
// Prices are approximate list rates used for a pre-flight estimate only.
// Matching is longest-prefix, so "gpt-4o-mini-2024-07-18" resolves to "gpt-4o-mini".
// Local models (Ollama, LM Studio, custom self-hosted) are free.
// ---------------------------------------------------------------------------
const PRICE_TABLE = [
  // Anthropic
  ['claude-opus-4', { in: 15.0, out: 75.0 }],
  ['claude-sonnet-4', { in: 3.0, out: 15.0 }],
  ['claude-haiku-4', { in: 1.0, out: 5.0 }],
  ['claude-3-5-sonnet', { in: 3.0, out: 15.0 }],
  ['claude-3-5-haiku', { in: 0.8, out: 4.0 }],
  ['claude-3-opus', { in: 15.0, out: 75.0 }],
  ['claude-3-haiku', { in: 0.25, out: 1.25 }],

  // OpenAI
  ['gpt-4o-mini', { in: 0.15, out: 0.6 }],
  ['gpt-4o', { in: 2.5, out: 10.0 }],
  ['gpt-4-turbo', { in: 10.0, out: 30.0 }],
  ['gpt-4', { in: 30.0, out: 60.0 }],
  ['gpt-3.5-turbo', { in: 0.5, out: 1.5 }],
  ['o3-mini', { in: 1.1, out: 4.4 }],
  ['o1-mini', { in: 1.1, out: 4.4 }],
  ['o1', { in: 15.0, out: 60.0 }],

  // Google
  ['gemini-2.0-flash', { in: 0.1, out: 0.4 }],
  ['gemini-1.5-flash', { in: 0.075, out: 0.3 }],
  ['gemini-1.5-pro', { in: 1.25, out: 5.0 }],
  ['gemini', { in: 0.5, out: 1.5 }],

  // Meta / Together / Fireworks / Groq (hosted Llama)
  ['llama-3.3-70b', { in: 0.88, out: 0.88 }],
  ['llama-3.1-405b', { in: 3.5, out: 3.5 }],
  ['llama-3.1-70b', { in: 0.88, out: 0.88 }],
  ['llama-3.1-8b', { in: 0.18, out: 0.18 }],
  ['llama', { in: 0.9, out: 0.9 }],

  // Chinese open-weights
  ['deepseek-chat', { in: 0.27, out: 1.1 }],
  ['deepseek-reasoner', { in: 0.55, out: 2.19 }],
  ['deepseek', { in: 0.27, out: 1.1 }],
  ['qwen-max', { in: 1.6, out: 6.4 }],
  ['qwen-plus', { in: 0.4, out: 1.2 }],
  ['qwen', { in: 0.4, out: 1.2 }],
]

/** Providers that run locally — always free. */
const FREE_PROVIDERS = new Set(['ollama', 'mock'])

/** Rough token estimate: 1 token ≈ 4 characters of English text. */
export function estimateTokensFromChars(chars) {
  return Math.ceil(chars / 4)
}

/**
 * Look up per-million-token pricing for a model id.
 * Returns null when the model is unknown (caller shows "unknown cost").
 */
export function getModelPricing(providerSlug, model) {
  if (FREE_PROVIDERS.has(providerSlug)) return { in: 0, out: 0, free: true }

  const normalized = (model || '').toLowerCase()
  // Longest-prefix match so specific entries beat generic family fallbacks
  let best = null
  let bestLen = 0
  for (const [key, price] of PRICE_TABLE) {
    if (normalized.includes(key) && key.length > bestLen) {
      best = price
      bestLen = key.length
    }
  }
  return best
}

// Prompt scaffolding (system prompt + instructions) added to every chunk call.
const PROMPT_OVERHEAD_CHARS = 1200
// Average characters produced per generated pair (instruction + output + JSON).
const CHARS_PER_PAIR = 500
// Observed average round-trip per chunk request, in seconds.
const SECONDS_PER_CHUNK = 6

/**
 * Pre-flight estimate for a full generation run.
 *
 * Mirrors the real chunking + pair-distribution logic in useGenerate.js so the
 * numbers shown match what will actually be requested.
 *
 * @returns {{
 *   chunkCount, totalPairs, inputTokens, outputTokens,
 *   costUSD: number|null, isFree: boolean, unknownPricing: boolean,
 *   seconds: number
 * }}
 */
export function estimateRun(documents, settings) {
  const pairCountPerDoc = settings.pairCount || 10
  const concurrency = Math.max(1, settings.concurrency || 3)

  let chunkCount = 0
  let inputChars = 0

  for (const doc of documents) {
    const raw = chunkDocument(doc.text, CHUNK_SIZE, CHUNK_OVERLAP)
    // useGenerate caps chunks at the requested pair count (1 pair minimum per chunk)
    const used = raw.slice(0, Math.min(raw.length, pairCountPerDoc))
    chunkCount += used.length
    for (const c of used) {
      inputChars += c.text.length + PROMPT_OVERHEAD_CHARS
    }
  }

  const totalPairs = pairCountPerDoc * documents.length
  const inputTokens = estimateTokensFromChars(inputChars)
  const outputTokens = estimateTokensFromChars(totalPairs * CHARS_PER_PAIR)

  const pricing = getModelPricing(settings.providerSlug, settings.model)
  const isFree = !!pricing?.free
  const unknownPricing = !pricing

  const costUSD = pricing
    ? (inputTokens / 1_000_000) * pricing.in + (outputTokens / 1_000_000) * pricing.out
    : null

  // Chunks run through a shared concurrency pool, so wall time is
  // (total chunks / parallel workers) × per-chunk latency.
  const seconds = Math.ceil((chunkCount / concurrency) * SECONDS_PER_CHUNK)

  return {
    chunkCount,
    totalPairs,
    inputTokens,
    outputTokens,
    costUSD,
    isFree,
    unknownPricing,
    seconds,
  }
}

/** Format a USD amount for display — sub-cent values show as "<$0.01". */
export function formatCost(usd) {
  if (usd === null || usd === undefined) return 'unknown'
  if (usd === 0) return 'free'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return `$${usd.toFixed(2)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

/** Format a duration in seconds as a compact human string. */
export function formatDuration(seconds) {
  if (seconds < 60) return `~${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `~${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `~${hours}h ${rem}m` : `~${hours}h`
}

/** Compact number formatting: 1234 → "1.2k", 1200000 → "1.2M". */
export function formatCompact(n) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
