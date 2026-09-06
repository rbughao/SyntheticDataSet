const VIEWS = [
  {
    id: 'sources',
    label: 'Sources',
    path: 'M4 6a2 2 0 012-2h3l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V6z',
  },
  {
    id: 'personas',
    label: 'Personas',
    path: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'settings',
    label: 'Settings',
    path: 'M10.3 4.3a1 1 0 011.4 0l.9.9a7.6 7.6 0 011.9.8l1.2-.3a1 1 0 011.1.5l.9 1.6a1 1 0 01-.2 1.2l-.9.9c.1.4.1.7.1 1.1s0 .7-.1 1.1l.9.9a1 1 0 01.2 1.2l-.9 1.6a1 1 0 01-1.1.5l-1.2-.3a7.6 7.6 0 01-1.9.8l-.9.9a1 1 0 01-1.4 0l-.9-.9a7.6 7.6 0 01-1.9-.8l-1.2.3a1 1 0 01-1.1-.5l-.9-1.6a1 1 0 01.2-1.2l.9-.9A6 6 0 016 12c0-.4 0-.7.1-1.1l-.9-.9a1 1 0 01-.2-1.2l.9-1.6a1 1 0 011.1-.5l1.2.3c.6-.35 1.23-.62 1.9-.8l.9-.9zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  },
]

/**
 * Switches the sidebar between its three views.
 *
 * The sidebar had grown into one long scroll holding sources, every generation
 * setting, the persona library and the provider config. Splitting it means each
 * view fits without scrolling past things you are not using.
 */
export default function SidebarNav({ view, onChange, badge }) {
  return (
    <div className="flex gap-1 px-3 pb-2" role="tablist" aria-label="Sidebar sections">
      {VIEWS.map((v) => {
        const active = view === v.id
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              active
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-3 hover:text-ink-2 hover:bg-surface/60'
            }`}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={v.path} />
            </svg>
            {v.label}
            {v.id === 'personas' && badge > 0 && (
              <span className="ml-0.5 text-[10px] font-semibold px-1.5 rounded-full bg-brand-soft text-brand-ink">
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
