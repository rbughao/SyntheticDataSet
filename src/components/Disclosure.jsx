import { useState, useEffect } from 'react'

/**
 * A collapsible section whose open/closed state persists.
 *
 * Used for the parts of Settings that are configured once and then rarely
 * touched, so they stop competing for sidebar space with the controls that get
 * adjusted every run.
 *
 * Renders a real disclosure — a button carrying aria-expanded — rather than a
 * div with a click handler, so it works from the keyboard and reads correctly
 * to assistive tech.
 *
 * @param {string}  storageKey  localStorage key remembering the state
 * @param {boolean} defaultOpen state on first visit, before anything is stored
 * @param {node}    title       always visible
 * @param {node}    [summary]   shown beside the title only while collapsed
 * @param {'heading'|'field'} [variant]  matches a section header or a field label
 */
export default function Disclosure({
  storageKey,
  defaultOpen = true,
  title,
  summary = null,
  variant = 'field',
  children,
}) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultOpen : stored !== 'false'
    } catch {
      return defaultOpen
    }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(open)) } catch { /* storage off */ }
  }, [storageKey, open])

  const titleClass =
    variant === 'heading'
      ? 'text-sm font-semibold text-ink-2 uppercase tracking-wide flex-shrink-0'
      : 'text-xs font-medium text-ink-3 flex-shrink-0'

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 text-left group ${open ? 'mb-2' : ''}`}
      >
        <span className={titleClass}>{title}</span>
        {!open && summary && (
          <span
            className="text-xs text-ink-3 truncate min-w-0"
            title={typeof summary === 'string' ? summary : undefined}
          >
            {summary}
          </span>
        )}
        <span className="flex-1" />
        <svg
          className={`w-4 h-4 text-ink-3 group-hover:text-ink-2 transition-transform flex-shrink-0 ${
            open ? 'rotate-180' : ''
          }`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && children}
    </div>
  )
}
