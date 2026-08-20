const ICONS = {
  light: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M12 3v1.5m0 15V21m9-9h-1.5m-15 0H3m15.36-6.36l-1.06 1.06M6.7 17.3l-1.06 1.06m12.72 0l-1.06-1.06M6.7 6.7L5.64 5.64M15.5 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
  ),
  dark: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M20.4 14.1A8.5 8.5 0 019.9 3.6a8.5 8.5 0 1010.5 10.5z" />
  ),
  system: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M4 5.5h16v10H4zM9.5 19.5h5M12 15.5v4" />
  ),
}

const NEXT = { light: 'dark', dark: 'system', system: 'light' }
const LABEL = { light: 'Light', dark: 'Dark', system: 'System' }

/**
 * Cycles light → dark → system. 'system' follows the OS setting live.
 */
export default function ThemeToggle({ mode, onCycle }) {
  return (
    <button
      onClick={onCycle}
      title={`Theme: ${LABEL[mode]} — click for ${LABEL[NEXT[mode]]}`}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[NEXT[mode]]}`}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors flex-shrink-0"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {ICONS[mode]}
      </svg>
      <span className="text-[11px] font-medium hidden lg:inline">{LABEL[mode]}</span>
    </button>
  )
}
