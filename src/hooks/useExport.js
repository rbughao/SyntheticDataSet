import { useCallback } from 'react'

/** Strip internal UI fields before export. */
function cleanPair(pair) {
  return { instruction: pair.instruction, output: pair.output, type: pair.type }
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

export function useExport() {
  const timestamp = () => Date.now()

  const exportJSONL = useCallback((pairs) => {
    const lines = pairs.map((p) => JSON.stringify(cleanPair(p))).join('\n')
    triggerDownload(lines, `dataset_${timestamp()}.jsonl`, 'application/jsonl')
  }, [])

  const exportJSON = useCallback((pairs) => {
    const content = JSON.stringify(pairs.map(cleanPair), null, 2)
    triggerDownload(content, `dataset_${timestamp()}.json`, 'application/json')
  }, [])

  const exportCSV = useCallback((pairs) => {
    const header = 'instruction,output,type'
    const rows = pairs.map((p) => {
      const clean = cleanPair(p)
      return [
        escapeCSVValue(clean.instruction),
        escapeCSVValue(clean.output),
        escapeCSVValue(clean.type),
      ].join(',')
    })
    const content = [header, ...rows].join('\n')
    triggerDownload(content, `dataset_${timestamp()}.csv`, 'text/csv')
  }, [])

  /** Rough token estimate: 1 token ≈ 4 chars */
  const estimateTokens = useCallback((pairs) => {
    const totalChars = pairs.reduce(
      (sum, p) => sum + (p.instruction?.length ?? 0) + (p.output?.length ?? 0),
      0
    )
    return Math.round(totalChars / 4)
  }, [])

  return { exportJSONL, exportJSON, exportCSV, estimateTokens }
}
