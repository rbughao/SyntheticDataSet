import { PROVIDERS } from '../providers/index.js'

export default function WorkspaceHeader({
  documentName,
  pairs,
  totalPairs,
  providerSlug,
  model,
  selectedIds,
  filterRating,
  filterType,
  searchQuery,
  onSelectAll,
  onDeselectAll,
  onDeleteSelected,
  onFilterChange,
  onFilterTypeChange,
  onSearchChange,
  onExport,
  isLargeOutputMode = false,
  isGenerating = false,
}) {
  const providerMeta = PROVIDERS[providerSlug] || {}
  const displayModel = model ? model.split('/').pop() : ''

  const allSelected = pairs.length > 0 && selectedIds.size === pairs.length
  const someSelected = selectedIds.size > 0

  // In large output mode while generating, hide filter/export/bulk controls —
  // there are no pair cards to interact with.
  const hideControls = isLargeOutputMode && isGenerating

  // True when any filter is narrowing the visible set
  const isFiltered =
    (totalPairs ?? pairs.length) !== pairs.length

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Document name */}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-800 truncate">
            {documentName || 'No document loaded'}
          </h2>
          <p className="text-xs text-gray-400">
            {isLargeOutputMode && isGenerating
              ? 'Large output mode — pairs are written directly to file'
              : isFiltered
              ? `${pairs.length.toLocaleString()} of ${totalPairs.toLocaleString()} pairs`
              : `${pairs.length.toLocaleString()} ${pairs.length === 1 ? 'pair' : 'pairs'}`}
          </p>
        </div>

        {/* Provider badge */}
        {providerSlug && (
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${providerMeta.badgeColor || 'bg-gray-100 text-gray-600'}`}>
            {providerMeta.label || providerSlug}
            {displayModel && <span className="opacity-70"> · {displayModel}</span>}
          </span>
        )}

        {/* Export button */}
        {!hideControls && (totalPairs ?? pairs.length) > 0 && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        )}
      </div>

      {/* Search + filters */}
      {!hideControls && (totalPairs ?? pairs.length) > 0 && (
        <div className="flex items-center gap-2 mt-2.5">
          {/* Search box */}
          <div className="relative flex-1 min-w-0">
            <svg
              className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search instructions and outputs…"
              className="w-full text-xs border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Clear search"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Type filter */}
          <select
            value={filterType}
            onChange={(e) => onFilterTypeChange(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-shrink-0"
          >
            <option value="all">All types</option>
            <option value="factual">Factual</option>
            <option value="instruction">Instruction</option>
          </select>

          {/* Rating / status filter */}
          <select
            value={filterRating}
            onChange={(e) => onFilterChange(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-shrink-0"
          >
            <option value="all">All pairs</option>
            <option value="up">👍 Thumbs up</option>
            <option value="down">👎 Thumbs down</option>
            <option value="unrated">Unrated</option>
            <option value="edited">Edited</option>
            <option value="flagged">⚠ Flagged</option>
            <option value="duplicate">Duplicates</option>
          </select>
        </div>
      )}

      {/* Bulk actions bar */}
      {!hideControls && pairs.length > 0 && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={allSelected ? onDeselectAll : onSelectAll}
              className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 cursor-pointer"
            />
            {allSelected ? 'Deselect all' : `Select all${isFiltered ? ' visible' : ''}`}
          </label>

          {someSelected && (
            <button
              onClick={onDeleteSelected}
              className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6" />
              </svg>
              Delete selected ({selectedIds.size})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
