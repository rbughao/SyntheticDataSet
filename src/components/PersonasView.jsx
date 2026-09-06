import { useState } from 'react'
import {
  PERSONA_FIELDS, CUSTOM_PERSONA_ID,
  savePersona, deletePersona, newPersona,
} from '../utils/personas.js'

/**
 * Persona editor.
 *
 * Editing a preset stores an override rather than mutating it, so "Reset"
 * always has something to fall back to.
 */
function Editor({ persona, onSave, onCancel }) {
  const [draft, setDraft] = useState(persona)
  const canSave = draft.name.trim() && draft.role.trim()

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }))

  return (
    <div className="border border-brand rounded-xl p-3 bg-surface">
      <p className="text-xs font-semibold text-ink mb-2.5">
        {persona.isPreset ? `Editing ${persona.name}` : persona.name ? 'Edit persona' : 'New persona'}
      </p>

      <div className="space-y-2">
        {PERSONA_FIELDS.map(({ key, label, placeholder, short }) => (
          <label key={key} className="block">
            <span className="block text-[11px] font-medium text-ink-3 mb-0.5">{label}</span>
            {short ? (
              <input
                type="text"
                value={draft[key] || ''}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className="w-full text-xs border border-line rounded-lg px-2.5 py-1.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            ) : (
              <textarea
                value={draft[key] || ''}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                rows={2}
                className="w-full text-xs border border-line rounded-lg px-2.5 py-1.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand resize-y"
              />
            )}
          </label>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-ink-3 leading-relaxed">
        These lines go into the prompt verbatim. Write them as continuations of
        “Who they are: …”, so lower case and no full stop reads best.
      </p>

      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-ink-3 hover:text-ink-2"
        >
          Cancel
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onSave(draft)}
          disabled={!canSave}
          className="px-3.5 py-1.5 text-xs font-semibold bg-brand hover:bg-brand-hover text-brand-on rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function PersonaRow({ persona, selected, onToggle, onEdit, onDelete }) {
  return (
    <div
      className={`rounded-xl border transition-colors ${
        selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start gap-2.5 p-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Use ${persona.name}`}
          className="w-4 h-4 accent-brand mt-0.5 flex-shrink-0"
        />
        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <span className={`block text-xs font-medium truncate ${selected ? 'text-brand-ink' : 'text-ink-2'}`}>
            {persona.name}
            {persona.isEdited && <span className="ml-1.5 text-[10px] text-ink-3 font-normal">edited</span>}
            {!persona.isPreset && <span className="ml-1.5 text-[10px] text-ink-3 font-normal">custom</span>}
          </span>
          <span className="block text-[10.5px] text-ink-3 truncate">{persona.summary}</span>
        </button>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onEdit}
            title={`Edit ${persona.name}`}
            aria-label={`Edit ${persona.name}`}
            className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {(persona.isEdited || !persona.isPreset) && (
            <button
              onClick={onDelete}
              title={persona.isPreset ? `Reset ${persona.name}` : `Delete ${persona.name}`}
              aria-label={persona.isPreset ? `Reset ${persona.name}` : `Delete ${persona.name}`}
              className="p-1 rounded-lg text-ink-3 hover:text-bad hover:bg-bad-soft transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {persona.isPreset ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The Personas subpage: choose whose point of view the dataset is written
 * from, and manage the library of personas.
 */
export default function PersonasView({ personas, settings, onChange, onPersonasChanged }) {
  const [editing, setEditing] = useState(null)   // persona object or null
  const selected = new Set(settings.personaIds || [])
  const quickOn = selected.has(CUSTOM_PERSONA_ID)

  function toggle(id) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange({ personaIds: [...next] })
  }

  function handleSave(draft) {
    onPersonasChanged(savePersona(draft))
    // A newly created persona is almost always wanted for the next run
    if (!selected.has(draft.id)) toggle(draft.id)
    setEditing(null)
  }

  function handleDelete(persona) {
    onPersonasChanged(deletePersona(persona.id))
    if (!persona.isPreset && selected.has(persona.id)) toggle(persona.id)
  }

  const activeCount = selected.size

  return (
    <div className="px-5 py-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wide">Personas</h2>
        <p className="text-[11px] text-ink-3 mt-1 leading-relaxed">
          Whose point of view the questions and answers are written from. Pick
          none for neutral pairs, or several to cover more than one audience.
        </p>
      </div>

      {editing ? (
        <Editor persona={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(newPersona())}
              className="flex-1 py-1.5 text-xs font-semibold border border-dashed border-line-strong hover:border-brand hover:text-brand-ink text-ink-2 rounded-full transition-colors"
            >
              + New persona
            </button>
            {activeCount > 0 && (
              <button
                onClick={() => onChange({ personaIds: [] })}
                className="px-3 py-1.5 text-xs text-ink-3 hover:text-ink-2"
              >
                Clear
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {personas.map((p) => (
              <PersonaRow
                key={p.id}
                persona={p}
                selected={selected.has(p.id)}
                onToggle={() => toggle(p.id)}
                onEdit={() => setEditing(p)}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>

          {/* Quick one-off persona, without adding to the library */}
          <div className={`rounded-xl border p-2.5 ${quickOn ? 'border-brand bg-brand-soft' : 'border-line'}`}>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={quickOn}
                onChange={() => toggle(CUSTOM_PERSONA_ID)}
                className="w-4 h-4 accent-brand flex-shrink-0"
              />
              <span className={`text-xs font-medium ${quickOn ? 'text-brand-ink' : 'text-ink-2'}`}>
                One-off persona
              </span>
            </label>
            {quickOn && (
              <textarea
                value={settings.customPersona || ''}
                onChange={(e) => onChange({ customPersona: e.target.value })}
                placeholder="A district nurse visiting patients at home, working from a phone between appointments, who needs the dosage rule and nothing else."
                rows={3}
                className="mt-2 w-full text-xs border border-line rounded-lg px-2.5 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand resize-y"
              />
            )}
            {!quickOn && (
              <p className="mt-1 ml-6 text-[10.5px] text-ink-3">
                Describe one in a sentence, without saving it
              </p>
            )}
          </div>

          <p className="text-[11px] text-ink-3 leading-relaxed pt-1">
            {activeCount === 0
              ? 'No persona selected — pairs will be neutral and encyclopedic.'
              : `Pairs split across ${activeCount} ${activeCount === 1 ? 'persona' : 'personas'}. Each gets its own request per chunk, so more personas means proportionally more calls — check the estimate below.`}
          </p>
        </>
      )}
    </div>
  )
}
