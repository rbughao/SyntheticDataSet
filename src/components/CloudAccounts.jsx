import { useState } from 'react'
import { CLOUD_PROVIDERS, redirectUri } from '../sources/cloudProviders.js'

function CopyableUri() {
  const [copied, setCopied] = useState(false)
  const uri = redirectUri()

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-ink-3 mb-1">Redirect URI to register:</p>
      <button
        onClick={copy}
        title="Copy to clipboard"
        className="w-full text-left font-mono text-[11px] bg-surface-3 hover:bg-line rounded-lg px-2 py-1.5 break-url transition-colors"
      >
        {uri}
        <span className="ml-1.5 text-brand-ink font-sans">{copied ? '· copied' : '· copy'}</span>
      </button>
    </div>
  )
}

function ProviderRow({ config, clientId, connection, onClientIdChange, onSignIn, onSignOut }) {
  const [showSetup, setShowSetup] = useState(false)
  const { status, profile, error } = connection
  const busy = status === 'connecting'

  return (
    <div className="border border-line rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-ink flex-1">{config.label}</span>
        {status === 'connected' && (
          <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-ok-soft text-ok-ink">
            Connected
          </span>
        )}
      </div>

      {status === 'connected' ? (
        <>
          <p className="text-xs text-ink-2 break-url">{profile?.name}</p>
          {profile?.email && profile.email !== profile.name && (
            <p className="text-[11px] text-ink-3 font-mono break-url">{profile.email}</p>
          )}
          <button
            onClick={() => onSignOut(config.id)}
            className="mt-2 w-full py-1.5 text-xs font-medium text-ink-3 hover:text-bad-ink hover:bg-bad-soft rounded-full transition-colors"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <input
            type="text"
            value={clientId}
            onChange={(e) => onClientIdChange(config.id, e.target.value)}
            placeholder="Client ID"
            spellCheck={false}
            className="w-full text-xs font-mono border border-line rounded-lg px-2.5 py-1.5 text-ink focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <button
            onClick={() => onSignIn(config.id)}
            disabled={!clientId.trim() || busy}
            className="mt-2 w-full py-1.5 text-xs font-semibold bg-brand hover:bg-brand-hover text-brand-on rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {busy && (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {busy ? 'Waiting for sign-in…' : `Connect ${config.label}`}
          </button>

          <button
            onClick={() => setShowSetup((v) => !v)}
            className="mt-1.5 text-[11px] text-ink-3 hover:text-ink-2"
          >
            {showSetup ? '▾' : '▸'} How to get a client ID
          </button>

          {showSetup && (
            <div className="mt-1.5 bg-surface-2 rounded-lg p-2.5">
              <ol className="text-[11px] text-ink-2 list-decimal list-inside space-y-1">
                {config.setup.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <a
                href={config.setup.console}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block mt-1.5 text-[11px] text-brand-ink hover:underline"
              >
                Open the console ↗
              </a>
              <CopyableUri />
            </div>
          )}
        </>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-bad-ink bg-bad-soft border border-bad-line rounded-lg px-2 py-1.5 break-url">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Connect Google Drive and OneDrive accounts.
 *
 * Each deployment supplies its own client ID: they are tied to the origin, so
 * one cannot ship with the app.
 */
export default function CloudAccounts({ clientIds, connections, onClientIdChange, onSignIn, onSignOut }) {
  return (
    <div className="space-y-2.5">
      {Object.values(CLOUD_PROVIDERS).map((config) => (
        <ProviderRow
          key={config.id}
          config={config}
          clientId={clientIds[config.id] || ''}
          connection={connections[config.id] || { status: 'idle' }}
          onClientIdChange={onClientIdChange}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
        />
      ))}
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Access tokens are kept in this tab's session only — never written to disk,
        and cleared when the tab closes. No refresh token is requested.
      </p>
    </div>
  )
}
