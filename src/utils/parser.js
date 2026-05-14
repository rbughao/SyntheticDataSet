/**
 * Thrown when the LLM response cannot be parsed as a valid Q&A array.
 * Carries the raw text so the UI can display it alongside a Retry button.
 */
export class ParseError extends Error {
  constructor(message, rawText) {
    super(message)
    this.name = 'ParseError'
    this.rawText = rawText
  }
}

function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim()
}

function extractJsonArray(text) {
  // Find the first '[' and the last ']' to extract the array even if there's surrounding text
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1)
  }
  return null
}

function validateItems(items, rawText) {
  if (!Array.isArray(items)) {
    throw new ParseError('LLM response is not a JSON array', rawText)
  }
  const valid = items.filter((item) => {
    if (typeof item.instruction !== 'string' || typeof item.output !== 'string') {
      console.warn('Skipping malformed pair (missing instruction/output):', item)
      return false
    }
    return true
  })
  // Normalise the type field
  return valid.map((item) => ({
    ...item,
    type: item.type === 'instruction' ? 'instruction' : 'factual',
  }))
}

/**
 * Attempt to parse the raw LLM response text into an array of Q&A pairs.
 * Tries four progressively more lenient strategies before throwing ParseError.
 */
export function parseResponse(rawText) {
  const original = rawText

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(rawText.trim())
    return validateItems(parsed, original)
  } catch {
    // fall through
  }

  // Strategy 2: strip markdown code fences and retry
  const stripped = stripFences(rawText)
  try {
    const parsed = JSON.parse(stripped)
    return validateItems(parsed, original)
  } catch {
    // fall through
  }

  // Strategy 3: regex-extract the JSON array from surrounding text
  const extracted = extractJsonArray(stripped)
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted)
      return validateItems(parsed, original)
    } catch {
      // fall through
    }
  }

  // Strategy 4: give up
  throw new ParseError(
    'Could not parse LLM response as a JSON array of Q&A pairs.',
    original
  )
}
