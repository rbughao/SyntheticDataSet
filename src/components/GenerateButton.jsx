export default function GenerateButton({ isLoading, onClick, onCancel, disabled, progress, documentCount = 1, largeOutputCount }) {
  const isDisabled = isLoading || disabled

  // Large output mode: pairs bypass React state and go into a ref buffer
  const isLargeOutput = largeOutputCount !== undefined

  // Multi-file parallel run (fileTotal present in progress)
  const isMultiFile = progress && progress.fileTotal > 1

  // Overall chunk progress across all files
  const hasChunkProgress = progress && progress.total > 1
  const chunkPct = hasChunkProgress
    ? Math.round((progress.completed / progress.total) * 100)
    : null

  // Button label
  const idleLabel = documentCount > 1
    ? `Process ${documentCount} Files`
    : 'Generate Dataset'

  const loadingLabel = isLargeOutput
    ? `${largeOutputCount.toLocaleString()} pairs buffered…`
    : isMultiFile
    ? `Processing ${progress.fileTotal} files in parallel…`
    : hasChunkProgress
    ? `Chunk ${progress.completed} / ${progress.total}`
    : 'Generating…'

  return (
    <div className="px-5 pt-4 pb-5 space-y-2.5">
      <button
        onClick={onClick}
        disabled={isDisabled}
        title={disabled && !isLoading ? 'Upload or paste a document first' : undefined}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-full font-semibold text-sm transition-all ${
          isDisabled
            ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
            : 'bg-brand hover:bg-brand-hover active:scale-[0.98] text-brand-on shadow-md'
        }`}
      >
        {isLoading ? (
          <>
            <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {loadingLabel}
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {idleLabel}
          </>
        )}
      </button>

      {/* Multi-file parallel info strip */}
      {isMultiFile && !isLargeOutput && (
        <div className="flex items-center justify-between text-xs text-ink-3 bg-brand-soft border border-brand-soft rounded-lg px-3 py-1.5">
          <span>⚡ Parallel processing</span>
          <span className="font-medium text-brand-ink">{progress.fileTotal} files</span>
        </div>
      )}

      {/* Large output mode: buffer counter (replaces pair cards) */}
      {isLargeOutput && (
        <div className="flex items-center justify-between text-xs text-ink-3 bg-warn-soft border border-warn-line rounded-lg px-3 py-2">
          <span>Writing to file — no preview</span>
          <span className="font-semibold text-brand-ink">
            {largeOutputCount.toLocaleString()} pairs
          </span>
        </div>
      )}

      {/* Overall chunk progress bar (all files combined, hidden in large output mode) */}
      {hasChunkProgress && !isLargeOutput && (
        <div className="space-y-1">
          <div className="w-full bg-surface-3 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-brand h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${chunkPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span>{progress.pairsCount} pair{progress.pairsCount !== 1 ? 's' : ''} so far</span>
            <span>{chunkPct}%</span>
          </div>
        </div>
      )}

      {/* Cancel button */}
      {isLoading && (
        <button
          onClick={onCancel}
          className="w-full py-2 text-xs font-medium text-ink-3 hover:text-bad-ink hover:bg-bad-soft rounded-full transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
