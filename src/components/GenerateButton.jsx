export default function GenerateButton({ isLoading, onClick, disabled }) {
  const isDisabled = isLoading || disabled

  return (
    <div className="p-4 border-t border-gray-100">
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
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating…
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
    </div>
  )
}
