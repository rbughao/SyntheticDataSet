import { PRESET_PERSONAS, CUSTOM_PERSONA_ID } from '../utils/personas.js'

/**
 * Choose whose point of view the dataset is written from.
 *
 * Multi-select on purpose: a real FAQ serves several audiences, and each
 * selected persona gets its own request per chunk so the voices stay distinct
 * rather than blurring into an average.
 */
export default function PersonaPicker({ personaIds = [], customPersona = '', onChange }) {
  const selected = new Set(personaIds)
  const customOn = selected.has(CUSTOM_PERSONA_ID)

  function toggle(id) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange({ personaIds: [...next] })
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs font-medium text-ink-3">
          Audience persona <span className="text-ink-3">(optional)</span>
        </label>
        {selected.size > 0 && (
          <button
            onClick={() => onChange({ personaIds: [] })}
            className="text-[11px] text-ink-3 hover:text-ink-2"
          >
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {PRESET_PERSONAS.map((p) => {
          const on = selected.has(p.id)
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              title={p.summary}
              aria-pressed={on}
              className={`text-left px-2.5 py-1.5 rounded-lg border transition-colors ${
                on
                  ? 'border-brand bg-brand-soft'
                  : 'border-line hover:border-line-strong bg-surface'
              }`}
            >
              <span className={`block text-xs font-medium truncate ${on ? 'text-brand-ink' : 'text-ink-2'}`}>
                {p.name}
              </span>
              <span className="block text-[10.5px] text-ink-3 truncate">{p.summary}</span>
            </button>
          )
        })}

        {/* Custom sits in the same grid so it reads as one more choice */}
        <button
          onClick={() => toggle(CUSTOM_PERSONA_ID)}
          aria-pressed={customOn}
          className={`text-left px-2.5 py-1.5 rounded-lg border border-dashed transition-colors ${
            customOn
              ? 'border-brand bg-brand-soft'
              : 'border-line-strong hover:border-ink-3 bg-surface'
          }`}
        >
          <span className={`block text-xs font-medium ${customOn ? 'text-brand-ink' : 'text-ink-2'}`}>
            Custom…
          </span>
          <span className="block text-[10.5px] text-ink-3 truncate">Describe your own</span>
        </button>
      </div>

      {customOn && (
        <textarea
          value={customPersona}
          onChange={(e) => onChange({ customPersona: e.target.value })}
          placeholder="A district nurse visiting patients at home, working from a phone between appointments, who needs the dosage rule and nothing else."
          rows={3}
          className="mt-2 w-full text-xs border border-line rounded-lg px-2.5 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand resize-y"
        />
      )}

      <p className="mt-1.5 text-[11px] text-ink-3 leading-relaxed">
        {selected.size === 0
          ? 'No persona: neutral, encyclopedic pairs.'
          : `Pairs are split across ${selected.size} ${selected.size === 1 ? 'persona' : 'personas'}, each asking and answering in character. More personas means more requests — check the estimate.`}
      </p>
    </div>
  )
}
