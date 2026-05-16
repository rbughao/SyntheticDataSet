export default function GenerateButton({ isLoading, onClick, onCancel, disabled, progress }) {
  const isDisabled = isLoading || disabled

  const isMultiChunk = progress && progress.total > 1
  const progressPct = isMultiChunk
    ? Math.round((progress.completed / progress.total) * 100)
    : null

  return (
    <div className="p-4 border-t border-gray-100 space-y-2">
      <button
        onClick={onClick}
        disabled={isDisabled}
        title={disabled && !isLoading ? 'Upload or paste a document first' : undefined}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${
          isDisabled
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white shadow-sm'
        }`}
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {isMultiChunk
              ? `Chunk ${progress.completed}/${progress.total}`
              : 'Generating…'}
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Dataset
          </>
        )}
      </button>

      {/* Multi-chunk progress bar */}
      {isMultiChunk && (
        <div className="space-y-1">
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {progress.pairsCount} pair{progress.pairsCount !== 1 ? 's' : ''} so far
            </p>
            <p className="text-xs text-gray-400">{progressPct}%</p>
          </div>
        </div>
      )}

      {/* Cancel button — appears during any loading state */}
      {isLoading && (
        <button
          onClick={onCancel}
          className="w-full py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 hover:bg-red-50 rounded-lg transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
