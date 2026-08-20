// ---------------------------------------------------------------------------
// Pair quality validation
//
// Heuristic checks that flag pairs likely to hurt a fine-tune. These are
// warnings, never auto-deletions — the user decides what to keep.
//
// Severity:
//   'error' — almost certainly unusable (empty, truncated mid-sentence)
//   'warn'  — suspicious, worth a human look
// ---------------------------------------------------------------------------

const MIN_OUTPUT_CHARS = 20
const MIN_INSTRUCTION_CHARS = 10
const MAX_OUTPUT_CHARS = 6000

// The system prompt explicitly forbids these, but models leak them anyway.
const SOURCE_LEAK_PATTERNS = [
  /according to the (document|text|excerpt|passage|article)/i,
  /as (stated|mentioned|described|noted) in the (document|text|excerpt|passage)/i,
  /the (document|text|excerpt|passage) (states|says|mentions|describes|notes)/i,
  /based on the (provided )?(document|text|excerpt|passage)/i,
  /in this (document|excerpt|passage)/i,
]

// A response that trails off without terminal punctuation is usually a
// max_tokens truncation.
function looksTruncated(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (t.length < 40) return false
  return !/[.!?"')\]}…]$/.test(t)
}

/**
 * Validate one pair.
 * @returns {Array<{ code: string, severity: 'error'|'warn', message: string }>}
 */
export function validatePair(pair) {
  const issues = []
  const instruction = (pair.instruction || '').trim()
  const output = (pair.output || '').trim()

  // ── Errors ──────────────────────────────────────────────────────────────
  if (!instruction) {
    issues.push({ code: 'empty_instruction', severity: 'error', message: 'Instruction is empty' })
  } else if (instruction.length < MIN_INSTRUCTION_CHARS) {
    issues.push({
      code: 'short_instruction',
      severity: 'error',
      message: `Instruction is only ${instruction.length} characters`,
    })
  }

  if (!output) {
    issues.push({ code: 'empty_output', severity: 'error', message: 'Output is empty' })
  } else if (output.length < MIN_OUTPUT_CHARS) {
    issues.push({
      code: 'short_output',
      severity: 'error',
      message: `Output is only ${output.length} characters`,
    })
  }

  if (output && looksTruncated(output)) {
    issues.push({
      code: 'truncated_output',
      severity: 'error',
      message: 'Output appears cut off mid-sentence (likely hit the token limit)',
    })
  }

  // ── Warnings ────────────────────────────────────────────────────────────
  for (const re of SOURCE_LEAK_PATTERNS) {
    if (re.test(output)) {
      issues.push({
        code: 'source_leak',
        severity: 'warn',
        message: 'Output references the source document instead of standing alone',
      })
      break
    }
  }

  if (output.length > MAX_OUTPUT_CHARS) {
    issues.push({
      code: 'long_output',
      severity: 'warn',
      message: `Output is unusually long (${output.length.toLocaleString()} chars)`,
    })
  }

  if (pair.type === 'factual' && instruction && !instruction.includes('?')) {
    issues.push({
      code: 'factual_no_question',
      severity: 'warn',
      message: 'Factual pair has no question mark in the instruction',
    })
  }

  if (instruction && output && instruction.toLowerCase() === output.toLowerCase()) {
    issues.push({
      code: 'echo',
      severity: 'warn',
      message: 'Output is identical to the instruction',
    })
  }

  if (pair.type && pair.type !== 'factual' && pair.type !== 'instruction') {
    issues.push({
      code: 'bad_type',
      severity: 'warn',
      message: `Unexpected type "${pair.type}"`,
    })
  }

  return issues
}

/**
 * Validate a whole dataset.
 * @returns {{
 *   issuesById: Map<string, Array>,
 *   errorIds: Set<string>, warnIds: Set<string>,
 *   errorCount: number, warnCount: number, flaggedCount: number
 * }}
 */
export function validateAll(pairs) {
  const issuesById = new Map()
  const errorIds = new Set()
  const warnIds = new Set()

  for (const p of pairs) {
    const issues = validatePair(p)
    if (!issues.length) continue
    issuesById.set(p.id, issues)
    if (issues.some((i) => i.severity === 'error')) errorIds.add(p.id)
    else warnIds.add(p.id)
  }

  return {
    issuesById,
    errorIds,
    warnIds,
    errorCount: errorIds.size,
    warnCount: warnIds.size,
    flaggedCount: issuesById.size,
  }
}
