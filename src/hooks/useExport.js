import { useCallback } from 'react'

// ---------------------------------------------------------------------------
// Export schemas
//
// Different fine-tuning stacks expect different JSON shapes. Emitting only one
// forces users to post-process in Python, so all the common ones are built in.
// ---------------------------------------------------------------------------

export const SCHEMAS = [
  {
    id: 'instruction',
    label: 'Instruction',
    description: '{ instruction, output, type }',
    note: 'This app’s native shape',
  },
  {
    id: 'chatml',
    label: 'ChatML',
    description: '{ messages: [{ role, content }] }',
    note: 'OpenAI, Together, Fireworks',
  },
  {
    id: 'alpaca',
    label: 'Alpaca',
    description: '{ instruction, input, output }',
    note: 'Stanford Alpaca, LLaMA-Factory',
  },
  {
    id: 'sharegpt',
    label: 'ShareGPT',
    description: '{ conversations: [{ from, value }] }',
    note: 'Axolotl, Vicuna',
  },
]

export const FORMATS = [
  { id: 'jsonl', label: 'JSONL', mime: 'application/jsonl', ext: 'jsonl' },
  { id: 'json', label: 'JSON', mime: 'application/json', ext: 'json' },
  { id: 'csv', label: 'CSV', mime: 'text/csv', ext: 'csv' },
]

/** Strip internal UI fields (id, rating, edited, sourceDocId) before export. */
function cleanPair(pair) {
  return { instruction: pair.instruction, output: pair.output, type: pair.type }
}

/** Convert one pair into the requested schema shape. */
export function toSchema(pair, schema) {
  const { instruction, output, type } = cleanPair(pair)

  switch (schema) {
    case 'chatml':
      return {
        messages: [
          { role: 'user', content: instruction },
          { role: 'assistant', content: output },
        ],
      }
    case 'alpaca':
      // `input` is the optional extra-context field; this app has no separate
      // context per pair, so it is always empty (required by the spec).
      return { instruction, input: '', output }
    case 'sharegpt':
      return {
        conversations: [
          { from: 'human', value: instruction },
          { from: 'gpt', value: output },
        ],
      }
    case 'instruction':
    default:
      return { instruction, output, type }
  }
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeCSVValue(value) {
  const str = String(value ?? '')
  // Wrap in quotes if the value contains a comma, double-quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Serialize pairs to a string in the given format + schema.
 * CSV always uses flat instruction/output/type columns — the nested schemas
 * (ChatML, ShareGPT) have no meaningful tabular representation.
 */
export function serialize(pairs, format, schema = 'instruction') {
  if (format === 'csv') {
    const header = 'instruction,output,type'
    const rows = pairs.map((p) => {
      const c = cleanPair(p)
      return [
        escapeCSVValue(c.instruction),
        escapeCSVValue(c.output),
        escapeCSVValue(c.type),
      ].join(',')
    })
    return [header, ...rows].join('\n')
  }

  const shaped = pairs.map((p) => toSchema(p, schema))
  if (format === 'json') return JSON.stringify(shaped, null, 2)
  return shaped.map((o) => JSON.stringify(o)).join('\n') // jsonl
}

/**
 * Deterministically split pairs into train/validation sets.
 *
 * Uses a strided pick rather than a random shuffle so the same input always
 * produces the same split — reproducible datasets matter for fine-tuning runs.
 *
 * @param {Array} pairs
 * @param {number} validationRatio  e.g. 0.1 for a 90/10 split
 */
export function splitTrainVal(pairs, validationRatio) {
  if (!validationRatio || validationRatio <= 0) return { train: pairs, val: [] }
  if (validationRatio >= 1) return { train: [], val: pairs }

  const valCount = Math.max(1, Math.round(pairs.length * validationRatio))
  const stride = pairs.length / valCount

  const valIdx = new Set()
  for (let i = 0; i < valCount; i++) {
    valIdx.add(Math.min(pairs.length - 1, Math.floor(i * stride + stride / 2)))
  }

  const train = []
  const val = []
  pairs.forEach((p, i) => (valIdx.has(i) ? val : train).push(p))
  return { train, val }
}

/**
 * Export pairs to file(s).
 *
 * When `validationRatio` is set, two files are downloaded (`_train` / `_val`)
 * instead of one.
 *
 * @param {Array}  pairs
 * @param {object} opts
 * @param {string} opts.format           'jsonl' | 'json' | 'csv'
 * @param {string} [opts.schema]         'instruction' | 'chatml' | 'alpaca' | 'sharegpt'
 * @param {number} [opts.validationRatio] 0 for no split, e.g. 0.1 for 90/10
 * @param {string} [opts.filenameBase]
 */
export function exportPairs(pairs, opts = {}) {
  const {
    format = 'jsonl',
    schema = 'instruction',
    validationRatio = 0,
    filenameBase,
  } = opts

  const fmt = FORMATS.find((f) => f.id === format) || FORMATS[0]
  const base = filenameBase || `dataset_${Date.now()}`

  if (validationRatio > 0) {
    const { train, val } = splitTrainVal(pairs, validationRatio)
    triggerDownload(serialize(train, format, schema), `${base}_train.${fmt.ext}`, fmt.mime)
    triggerDownload(serialize(val, format, schema), `${base}_val.${fmt.ext}`, fmt.mime)
    return { trainCount: train.length, valCount: val.length }
  }

  triggerDownload(serialize(pairs, format, schema), `${base}.${fmt.ext}`, fmt.mime)
  return { trainCount: pairs.length, valCount: 0 }
}

/**
 * Export a large ref buffer directly to a file, bypassing React state.
 * Used by large output mode (pairCount > 1000).
 */
export function exportBufferAs(format, pairs, schema = 'instruction') {
  return exportPairs(pairs, { format, schema })
}

export function useExport() {
  const exportJSONL = useCallback((pairs, schema) => {
    exportPairs(pairs, { format: 'jsonl', schema })
  }, [])

  const exportJSON = useCallback((pairs, schema) => {
    exportPairs(pairs, { format: 'json', schema })
  }, [])

  const exportCSV = useCallback((pairs) => {
    exportPairs(pairs, { format: 'csv' })
  }, [])

  /** Rough token estimate: 1 token ≈ 4 chars */
  const estimateTokens = useCallback((pairs) => {
    const totalChars = pairs.reduce(
      (sum, p) => sum + (p.instruction?.length ?? 0) + (p.output?.length ?? 0),
      0
    )
    return Math.round(totalChars / 4)
  }, [])

  return { exportJSONL, exportJSON, exportCSV, exportPairs, estimateTokens }
}
