import { useExport } from '../hooks/useExport.js'

export default function ExportModal({ pairs, onClose }) {
  const { exportJSONL, exportJSON, exportCSV, estimateTokens } = useExport()

  const factualCount = pairs.filter((p) => p.type === 'factual').length
  const instructionCount = pairs.filter((p) => p.type === 'instruction').length
  const tokenEstimate = estimateTokens(pairs)

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Export Dataset</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-5 space-y-2">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Summary</h3>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Total pairs</span>
            <span className="font-medium text-gray-900">{pairs.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Factual pairs</span>
            <span className="font-medium">
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">
                {factualCount}
              </span>
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Instruction pairs</span>
            <span className="font-medium">
              <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs">
                {instructionCount}
              </span>
            </span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-500">Est. tokens</span>
            <span className="font-medium text-gray-900">{tokenEstimate.toLocaleString()}</span>
          </div>
        </div>

        {/* Export buttons */}
        <div className="space-y-2">
          <button
            onClick={() => { exportJSONL(pairs); onClose() }}
            className="w-full flex items-center justify-between px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            <span className="font-medium">Export as JSONL</span>
            <span className="text-indigo-200 text-sm">Fine-tuning standard</span>
          </button>
          <button
            onClick={() => { exportJSON(pairs); onClose() }}
            className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-lg transition-colors"
          >
            <span className="font-medium">Export as JSON</span>
            <span className="text-gray-400 text-sm">Full array</span>
          </button>
          <button
            onClick={() => { exportCSV(pairs); onClose() }}
            className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-lg transition-colors"
          >
            <span className="font-medium">Export as CSV</span>
            <span className="text-gray-400 text-sm">Spreadsheet-friendly</span>
          </button>
        </div>
      </div>
    </div>
  )
}
