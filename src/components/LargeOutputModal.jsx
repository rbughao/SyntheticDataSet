import { useState } from 'react'

const FORMAT_OPTIONS = [
  {
    id: 'jsonl',
    label: 'JSONL',
    description: 'One {"instruction","output","type"} object per line',
    note: 'Recommended for fine-tuning',
  },
  {
    id: 'json',
    label: 'JSON',
    description: 'Full array, pretty-printed',
    note: 'Easy to inspect',
  },
  {
    id: 'csv',
    label: 'CSV',
    description: 'instruction, output, type columns',
    note: 'Spreadsheet-friendly',
  },
]

/**
 * Shown before generation starts when pairCount > 1000.
 * Explains why direct-to-file mode is used and lets the user pick a format.
 *
 * Props:
 *   pairCount  — number of pairs requested
 *   onConfirm(format)  — called with 'jsonl' | 'json' | 'csv'
 *   onCancel   — called when user dismisses without starting
 */
export default function LargeOutputModal({ pairCount, onConfirm, onCancel }) {
  const [selectedFormat, setSelectedFormat] = useState('jsonl')

  const estimatedKB = Math.round(pairCount * 500 / 1024)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-surface rounded-3xl shadow-xl animate-slide-up w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warn-soft flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Large Dataset — Direct-to-File Mode</h2>
              <p className="text-xs text-ink-3 mt-0.5">{pairCount.toLocaleString()} pairs requested</p>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <div className="px-6 py-4">
          <div className="bg-warn-soft border border-warn-line rounded-xl p-4 text-sm text-warn-ink space-y-2 mb-5">
            <p>
              At <strong>{pairCount.toLocaleString()} pairs</strong>, displaying results on screen would
              freeze the UI and consume significant memory, so this run writes directly to a file.
            </p>
            <div>
              <p className="font-semibold mb-1">Why save to file?</p>
              <ul className="space-y-1 text-xs list-disc list-inside text-warn-ink">
                <li>
                  Rendering {pairCount.toLocaleString()} pair cards triggers thousands of DOM updates that block the main thread
                </li>
                <li>
                  Holding ~{estimatedKB.toLocaleString()} KB of pairs in browser memory causes garbage collection pauses
                </li>
              </ul>
            </div>
            <p className="text-xs text-warn-ink">
              During generation you will see a live pair counter. When generation finishes your browser will automatically download the dataset.
            </p>
          </div>

          {/* Format picker */}
          <p className="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-3">Choose output format</p>
          <div className="space-y-2">
            {FORMAT_OPTIONS.map((opt) => {
              const isSelected = selectedFormat === opt.id
              return (
                <label
                  key={opt.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand-soft'
                      : 'border-line hover:border-line-strong bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={opt.id}
                    checked={isSelected}
                    onChange={() => setSelectedFormat(opt.id)}
                    className="mt-0.5 accent-brand flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isSelected ? 'text-brand-ink' : 'text-ink-2'}`}>
                        {opt.label}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        isSelected ? 'bg-brand-soft text-brand-ink' : 'bg-surface-3 text-ink-3'
                      }`}>
                        {opt.note}
                      </span>
                    </div>
                    <p className="text-xs text-ink-3 mt-0.5">{opt.description}</p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-ink-3 hover:text-ink-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedFormat)}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand hover:bg-brand-hover text-brand-on text-sm font-semibold rounded-full transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Start Generating
          </button>
        </div>
      </div>
    </div>
  )
}
