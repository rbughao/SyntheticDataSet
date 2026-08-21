import { useState } from 'react'
import { CLOUD_PROVIDERS } from '../sources/cloudProviders.js'

const HINTS = {
  gdrive: {
    placeholder: 'Drive folder link or ID',
    help: 'Paste a Drive folder link, or the folder ID on its own.',
    required: true,
  },
  onedrive: {
    placeholder: 'OneDrive folder link (optional)',
    help: 'Paste a folder link, or leave empty to use your whole drive.',
    required: false,
  },
}

function ProviderBlock({ config, connected, busy, progress, error, onImport, onCancel }) {
  const [value, setValue] = useState('')
  const hint = HINTS[config.id]

  if (!connected) return null

  return (
    <div className="border border-line rounded-xl p-3">
      <p className="text-sm font-medium text-ink mb-2">{config.label}</p>

      <form
        onSubmit={(e) => { e.preventDefault(); onImport(config.id, value) }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={hint.placeholder}
          spellCheck={false}
          className="w-full text-xs border border-line rounded-lg px-2.5 py-1.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={busy || (hint.required && !value.trim())}
          className="mt-2 w-full py-1.5 text-xs font-semibold bg-brand hover:bg-brand-hover text-brand-on rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {busy && (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {busy ? 'Listing…' : 'Browse folder'}
        </button>
      </form>

      {busy && progress && (
        <div className="mt-2 bg-surface-3 rounded-lg px-2.5 py-2">
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-ink-2">
            <span>{progress.found} found</span>
            <span className="text-ink-3">{progress.folders} folders left</span>
          </div>
          {progress.current && (
            <p className="mt-0.5 text-[10.5px] text-ink-3 font-mono break-url leading-snug">
              {progress.current}
            </p>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="mt-1.5 w-full py-1 text-[11px] font-medium text-ink-3 hover:text-bad-ink hover:bg-bad-soft rounded-full transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      {!busy && <p className="mt-1.5 text-[11px] text-ink-3 leading-relaxed">{hint.help}</p>}

      {error && (
        <p className="mt-2 text-[11px] text-bad-ink bg-bad-soft border border-bad-line rounded-lg px-2 py-1.5 break-url">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Import from a connected cloud account.
 *
 * Connecting happens in Settings, because it needs a client ID; this tab only
 * deals with picking a folder once an account is available.
 */
export default function CloudBrowser({ connections, cloudBusy, cloudProgress, cloudError, onImport, onCancel }) {
  const connected = Object.values(CLOUD_PROVIDERS).filter(
    (c) => connections[c.id]?.status === 'connected'
  )

  if (!connected.length) {
    return (
      <div className="border-2 border-dashed border-line rounded-xl p-6 text-center">
        <svg className="w-8 h-8 mx-auto text-ink-3 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9" />
        </svg>
        <p className="text-sm text-ink-3">No account connected</p>
        <p className="text-xs text-ink-3 mt-1 leading-relaxed">
          Connect Google Drive or OneDrive under <strong className="text-ink-2">Cloud sources</strong> in
          Settings below.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {connected.map((config) => (
        <ProviderBlock
          key={config.id}
          config={config}
          connected
          busy={cloudBusy === config.id}
          progress={cloudProgress}
          error={cloudError?.id === config.id ? cloudError.message : null}
          onImport={onImport}
          onCancel={onCancel}
        />
      ))}
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Subfolders are included. You review everything found — and what it would
        cost — before importing.
      </p>
    </div>
  )
}
