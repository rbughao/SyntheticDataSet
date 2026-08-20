import { useState } from 'react'
import { SCHEMAS, FORMATS, exportPairs, splitTrainVal, toSchema } from '../hooks/useExport.js'

const SPLIT_OPTIONS = [
  { id: 0, label: 'No split', hint: 'Single file' },
  { id: 0.1, label: '90 / 10', hint: 'train + val' },
  { id: 0.2, label: '80 / 20', hint: 'train + val' },
]

export default function ExportModal({ pairs, selectedIds, onClose }) {
  const [schema, setSchema] = useState('instruction')
  const [format, setFormat] = useState('jsonl')
  const [validationRatio, setValidationRatio] = useState(0)
  const [selectedOnly, setSelectedOnly] = useState(false)

  const hasSelection = selectedIds && selectedIds.size > 0
  const exportSet = selectedOnly && hasSelection
    ? pairs.filter((p) => selectedIds.has(p.id))
    : pairs

  const factualCount = exportSet.filter((p) => p.type === 'factual').length
  const instructionCount = exportSet.filter((p) => p.type === 'instruction').length
  const tokenEstimate = Math.round(
    exportSet.reduce(
      (sum, p) => sum + (p.instruction?.length ?? 0) + (p.output?.length ?? 0),
      0
    ) / 4
  )

  const { train, val } = splitTrainVal(exportSet, validationRatio)

  // CSV flattens to instruction/output/type columns — nested schemas don't apply
  const schemaDisabled = format === 'csv'

  // Live preview of the first pair in the chosen schema
  const previewObj = exportSet.length
    ? toSchema(exportSet[0], schemaDisabled ? 'instruction' : schema)
    : null

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  function handleExport() {
    exportPairs(exportSet, {
      format,
      schema: schemaDisabled ? 'instruction' : schema,
      validationRatio,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface rounded-3xl shadow-xl animate-slide-up w-full max-w-lg my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-ink">Export Dataset</h2>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Selected-only toggle */}
          {hasSelection && (
            <label className="flex items-center gap-2.5 text-sm bg-brand-soft border border-brand-soft rounded-xl px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(e) => setSelectedOnly(e.target.checked)}
                className="w-4 h-4 text-brand-ink rounded border-line-strong"
              />
              <span className="text-ink-2">
                Export selected only
                <span className="text-ink-3"> ({selectedIds.size} of {pairs.length})</span>
              </span>
            </label>
          )}

          {/* Summary */}
          <div className="bg-surface-2 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Total pairs</span>
              <span className="font-semibold text-ink">{exportSet.length.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Factual / Instruction</span>
              <span className="font-medium text-ink-2">
                <span className="bg-info-soft text-info-ink px-2 py-0.5 rounded-full text-xs">{factualCount}</span>
                <span className="mx-1 text-ink-3">/</span>
                <span className="bg-alt-soft text-alt-ink px-2 py-0.5 rounded-full text-xs">{instructionCount}</span>
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-line pt-2">
              <span className="text-ink-3">Est. tokens</span>
              <span className="font-medium text-ink">{tokenEstimate.toLocaleString()}</span>
            </div>
            {validationRatio > 0 && (
              <div className="flex justify-between text-sm border-t border-line pt-2">
                <span className="text-ink-3">Split</span>
                <span className="font-medium text-ink-2">
                  {train.length.toLocaleString()} train · {val.length.toLocaleString()} val
                </span>
              </div>
            )}
          </div>

          {/* Schema picker */}
          <div>
            <p className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-2">
              Schema
              {schemaDisabled && (
                <span className="ml-2 normal-case font-normal text-ink-3">
                  — CSV always uses flat columns
                </span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SCHEMAS.map((s) => {
                const isSelected = !schemaDisabled && schema === s.id
                return (
                  <button
                    key={s.id}
                    disabled={schemaDisabled}
                    onClick={() => setSchema(s.id)}
                    className={`text-left p-2.5 rounded-xl border-2 transition-colors ${
                      schemaDisabled
                        ? 'border-line bg-surface-2 opacity-50 cursor-not-allowed'
                        : isSelected
                        ? 'border-brand bg-brand-soft'
                        : 'border-line hover:border-line-strong bg-surface'
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${isSelected ? 'text-brand-ink' : 'text-ink-2'}`}>
                      {s.label}
                    </span>
                    <span className="block text-xs text-ink-3 mt-0.5 truncate" title={s.note}>
                      {s.note}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Format + split */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-2">Format</p>
              <div className="flex gap-1.5">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`flex-1 px-2 py-2 text-xs font-semibold rounded-lg border-2 transition-colors ${
                      format === f.id
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line text-ink-2 hover:border-line-strong'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-2">Train / val split</p>
              <div className="flex gap-1.5">
                {SPLIT_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setValidationRatio(o.id)}
                    className={`flex-1 px-2 py-2 text-xs font-semibold rounded-lg border-2 transition-colors ${
                      validationRatio === o.id
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line text-ink-2 hover:border-line-strong'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live preview */}
          {previewObj && (
            <div>
              <p className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-2">Preview — first record</p>
              <pre className="text-xs bg-code-bg text-code-fg rounded-xl p-3 overflow-x-auto max-h-40 leading-relaxed">
{format === 'csv'
  ? 'instruction,output,type\n"…","…",factual'
  : JSON.stringify(previewObj, null, format === 'json' ? 2 : 0)}
              </pre>
            </div>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exportSet.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand hover:bg-brand-hover disabled:bg-surface-3 disabled:text-ink-3 text-brand-on font-semibold rounded-full transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {validationRatio > 0
              ? `Download 2 files (${exportSet.length.toLocaleString()} pairs)`
              : `Download ${exportSet.length.toLocaleString()} pairs`}
          </button>
        </div>
      </div>
    </div>
  )
}
