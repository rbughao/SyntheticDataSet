import { useState, useRef, useLayoutEffect } from 'react'

function autoResize(el) {
  if (!el) return
  // Must collapse to 0 before measuring: with height:auto a textarea falls back
  // to its `rows` height (2 by default), so scrollHeight reports that instead
  // of the real content height and the field never shrinks.
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

const TYPE_BADGE = {
  factual: 'bg-info-soft text-info-ink',
  instruction: 'bg-alt-soft text-alt-ink',
}

export default function PairCard({
  pair,
  index,
  isSelected,
  issues,
  isDuplicate,
  onUpdate,
  onDelete,
  onRegenerate,
  onToggleSelect,
  // dnd-kit drag handle props passed from SortablePairCard wrapper
  listeners,
  attributes,
  isDragging,
}) {
  const hasError = issues?.some((i) => i.severity === 'error')
  const hasWarn = issues?.length > 0 && !hasError
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const instrRef = useRef(null)
  const outRef = useRef(null)

  // Size both textareas to their content on mount and whenever the text
  // changes from outside (regenerate, virtualized row reuse). Without this a
  // textarea keeps its default two-row height and leaves dead space.
  useLayoutEffect(() => {
    autoResize(instrRef.current)
    autoResize(outRef.current)
  }, [pair.instruction, pair.output])

  function handleInstructionChange(e) {
    autoResize(e.target)
    onUpdate(pair.id, { instruction: e.target.value })
  }

  function handleOutputChange(e) {
    autoResize(e.target)
    onUpdate(pair.id, { output: e.target.value })
  }

  async function handleRegenerate() {
    setIsRegenerating(true)
    try {
      await onRegenerate(pair)
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <div
      className={`bg-surface rounded-2xl px-5 py-4 mb-4 transition-shadow duration-200 ${
        isDragging ? 'opacity-50 shadow-xl ring-2 ring-brand' : 'shadow-sm hover:shadow-md'
      } ${isSelected ? 'ring-2 ring-brand' : ''} ${
        hasError
          ? 'ring-1 ring-bad-line'
          : hasWarn || isDuplicate
          ? 'ring-1 ring-warn-line'
          : ''
      }`}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 mb-3">
        {/* Drag handle */}
        <div
          {...listeners}
          {...attributes}
          className="cursor-grab active:cursor-grabbing text-ink-3 hover:text-ink-3 flex-shrink-0"
          title="Drag to reorder"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a1 1 0 110 2 1 1 0 010-2zm6 0a1 1 0 110 2 1 1 0 010-2zM7 7a1 1 0 110 2 1 1 0 010-2zm6 0a1 1 0 110 2 1 1 0 010-2zM7 12a1 1 0 110 2 1 1 0 010-2zm6 0a1 1 0 110 2 1 1 0 010-2z" />
          </svg>
        </div>

        {/* Pair number */}
        <span className="text-xs font-mono text-ink-3 flex-shrink-0">#{index + 1}</span>

        {/* Type badge */}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[pair.type] || TYPE_BADGE.factual}`}>
          {pair.type === 'instruction' ? 'Instruction' : 'Factual'}
        </span>

        {pair.personaName && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-soft text-brand-ink"
            title="Written from this point of view"
          >
            {pair.personaName}
          </span>
        )}

        {pair.edited && (
          <span className="text-xs text-warn-ink bg-warn-soft px-2 py-0.5 rounded-full">
            edited
          </span>
        )}

        {isDuplicate && (
          <span
            className="text-xs text-warn-ink bg-warn-soft px-2 py-0.5 rounded-full"
            title="Near-identical to an earlier pair"
          >
            duplicate
          </span>
        )}

        {hasError && (
          <span className="text-xs text-bad-ink bg-bad-soft px-2 py-0.5 rounded-full">
            ⚠ issue
          </span>
        )}
        {hasWarn && (
          <span className="text-xs text-warn-ink bg-warn-soft px-2 py-0.5 rounded-full">
            ⚠ check
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Checkbox for bulk select */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(pair.id)}
          className="w-4 h-4 text-brand-ink rounded border-line-strong cursor-pointer"
        />
      </div>

      {/* Quality issues */}
      {issues?.length > 0 && (
        <ul
          className={`mb-3 rounded-lg px-3 py-2 space-y-0.5 text-xs ${
            hasError
              ? 'bg-bad-soft border border-bad-line text-bad-ink'
              : 'bg-warn-soft border border-warn-line text-warn-ink'
          }`}
        >
          {issues.map((issue) => (
            <li key={issue.code}>• {issue.message}</li>
          ))}
        </ul>
      )}

      {/* Instruction — set in the display face; this is the question the
          reader scans first, so it carries the most typographic weight. */}
      <div className="mb-3">
        <label className="eyebrow mb-1.5 block">Instruction</label>
        <textarea
          ref={instrRef}
          value={pair.instruction}
          onChange={handleInstructionChange}
          onInput={(e) => autoResize(e.target)}
          className="w-full font-display text-[16px] font-semibold text-ink bg-transparent rounded-lg px-2 -mx-2 py-1 leading-snug transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand"
          rows={1}
          style={{ minHeight: "28px" }}
        />
      </div>

      {/* Output */}
      <div className="mb-2">
        <label className="eyebrow mb-1.5 block">Output</label>
        <textarea
          ref={outRef}
          value={pair.output}
          onChange={handleOutputChange}
          onInput={(e) => autoResize(e.target)}
          className="w-full text-[14.5px] text-ink-2 bg-transparent rounded-lg px-2 -mx-2 py-1 leading-[1.65] transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand"
          rows={1}
          style={{ minHeight: "28px" }}
        />
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2">
        {/* Rating */}
        <button
          onClick={() => onUpdate(pair.id, { rating: pair.rating === 'up' ? null : 'up' })}
          className={`p-1.5 rounded-lg transition-colors ${
            pair.rating === 'up'
              ? 'bg-ok-soft text-ok-ink'
              : 'text-ink-3 hover:text-ok hover:bg-ok-soft'
          }`}
          title="Thumbs up"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
          </svg>
        </button>
        <button
          onClick={() => onUpdate(pair.id, { rating: pair.rating === 'down' ? null : 'down' })}
          className={`p-1.5 rounded-lg transition-colors ${
            pair.rating === 'down'
              ? 'bg-bad-soft text-bad-ink'
              : 'text-ink-3 hover:text-bad hover:bg-bad-soft'
          }`}
          title="Thumbs down"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.105-1.79l-.05-.025A4 4 0 0011.055 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* Regenerate */}
        <button
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-ink-3 hover:text-brand-ink hover:bg-brand-soft rounded-lg transition-colors disabled:opacity-50"
        >
          {isRegenerating ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {isRegenerating ? 'Regenerating…' : 'Regenerate'}
        </button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDelete(pair.id)}
              className="px-2.5 py-1.5 text-xs bg-bad text-surface rounded-lg hover:bg-bad transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 text-ink-3 hover:text-bad hover:bg-bad-soft rounded-lg transition-colors"
            title="Delete pair"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
