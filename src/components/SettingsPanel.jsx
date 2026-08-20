import { useState, useEffect } from 'react'
import { PROVIDERS } from '../providers/index.js'
import { proxyFetch } from '../utils/corsProxy.js'

// Connection / model-fetch status values
const IDLE = 'idle'
const LOADING = 'loading'
const OK = 'ok'
const ERROR = 'error'

// ---------------------------------------------------------------------------
// fetchModelsForProvider — unified model-listing across all providers
// ---------------------------------------------------------------------------
/**
 * Fetch the list of available model IDs for any provider.
 * Returns a sorted string array.
 * Throws with a human-readable message on failure.
 */
async function fetchModelsForProvider(slug, { apiKey, baseURL, subProvider }) {
  const authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}

  if (slug === 'openai') {
    const res = await proxyFetch('https://api.openai.com/v1/models', { headers: authHeaders })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.data || []).map((m) => m.id).filter(Boolean).sort()
  }

  if (slug === 'google') {
    // Google models endpoint uses the API key as a header (not in the URL)
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey || '', 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.models || [])
      .map((m) => m.name?.replace('models/', ''))
      .filter((name) => name && name.startsWith('gemini'))
      .sort()
  }

  if (slug === 'meta') {
    const base = (baseURL || PROVIDERS.meta.baseURLOptions?.[0]?.value || '').replace(/\/+$/, '')
    if (!base) throw new Error('No API host selected')
    const res = await proxyFetch(`${base}/models`, { headers: authHeaders })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.data ?? [])
    return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort()
  }

  if (slug === 'chinese') {
    const subMeta = PROVIDERS.chinese.subProviders?.[subProvider] || {}
    const base = (subMeta.baseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('No base URL for the selected sub-provider')
    const res = await proxyFetch(`${base}/models`, { headers: authHeaders })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.data ?? [])
    return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort()
  }

  if (slug === 'ollama' || slug === 'custom') {
    const base = (baseURL || '').replace(/\/+$/, '')
    if (!base) throw new Error('Base URL is empty')
    const res = await proxyFetch(`${base}/models`, { headers: authHeaders })
    if (!res.ok) {
      // Try to parse structured proxy error (new JSON format) for a friendlier message
      let friendlyMsg = `HTTP ${res.status}`
      try {
        const errBody = await res.json()
        if (errBody?.code === 'ECONNREFUSED') {
          friendlyMsg = slug === 'ollama'
            ? 'Cannot connect — is Ollama running? Try: ollama serve'
            : `Connection refused at ${base}. Is the server running?`
        } else if (errBody?.message) {
          friendlyMsg = errBody.message.slice(0, 160)
        }
      } catch {
        const text = await res.text().catch(() => '')
        if (text) friendlyMsg += `: ${text.slice(0, 120)}`
      }
      throw new Error(friendlyMsg)
    }
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.data ?? [])
    return items.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort()
  }

  return []
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SettingsPanel({ settings, onChange }) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [connStatus, setConnStatus] = useState(IDLE)
  const [connError, setConnError] = useState('')
  const [discoveredModels, setDiscoveredModels] = useState([])

  const providerMeta = PROVIDERS[settings.providerSlug] || {}
  const isOllama = settings.providerSlug === 'ollama'
  const isCustom = settings.providerSlug === 'custom'
  const isMeta = settings.providerSlug === 'meta'
  const isChinese = settings.providerSlug === 'chinese'
  const isAnthropic = settings.providerSlug === 'anthropic'
  const isMock = settings.providerSlug === 'mock'
  const hasFreeTextModel = providerMeta.freeTextModel
  const hasBaseURLOptions = Array.isArray(providerMeta.baseURLOptions)

  // Providers that support live model listing (all except Mock and Anthropic)
  const canFetchModels = !isMock && !isAnthropic
  // Providers with a base URL input + connection test (Ollama, Custom)
  const showConnectionTest = isCustom || isOllama

  // ── Reset connection state when provider or base URL changes ──────────────
  useEffect(() => {
    setConnStatus(IDLE)
    setDiscoveredModels([])
    setConnError('')
  }, [settings.baseURL, settings.providerSlug])

  // ── Auto-fetch models when provider changes and an API key is already saved ─
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!canFetchModels) return
    if (!settings.apiKey) return
    if (showConnectionTest && !settings.baseURL) return // Custom/Ollama need base URL

    let cancelled = false
    // Don't set LOADING here — auto-fetch is silent (no spinner shown to user).
    // The user can always click Refresh / Test to get explicit feedback.

    fetchModelsForProvider(settings.providerSlug, {
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      subProvider: settings.subProvider,
    })
      .then((models) => {
        if (cancelled) return
        setDiscoveredModels(models)
        setConnStatus(models.length > 0 ? OK : IDLE)
        if (models.length === 1 && !settings.model) onChange({ model: models[0] })
      })
      .catch((err) => {
        if (cancelled) return
        // Auto-fetch failure is silent — user can retry with the Refresh button
        setConnStatus(IDLE)
        console.warn('Auto model fetch failed:', err.message)
      })

    return () => { cancelled = true }
  }, [settings.providerSlug]) // intentionally only on provider change

  // ── Shared model-fetch handler (Refresh button + Test Connection button) ──
  async function handleFetchModels() {
    setConnStatus(LOADING)
    setDiscoveredModels([])
    setConnError('')
    try {
      const models = await fetchModelsForProvider(settings.providerSlug, {
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        subProvider: settings.subProvider,
      })
      setDiscoveredModels(models)
      setConnStatus(OK)
      if (models.length === 1 && !settings.model) onChange({ model: models[0] })
    } catch (err) {
      setConnStatus(ERROR)
      setConnError(err.message)
    }
  }

  // ── Provider change ───────────────────────────────────────────────────────
  function handleProviderChange(slug) {
    const meta = PROVIDERS[slug] || {}
    const defaultModel = meta.defaultModel || ''
    const storedKey = localStorage.getItem(`apiKey_${slug}`) || ''
    const storedBaseURL = localStorage.getItem(`baseURL_${slug}`) || ''
    const storedProxyUrl = localStorage.getItem(`proxyBaseUrl_${slug}`) || ''
    const defaultBaseURL = storedBaseURL || meta.baseURLOptions?.[0]?.value || ''
    const defaultSubProvider = meta.defaultSubProvider || ''
    const subMeta = defaultSubProvider ? meta.subProviders?.[defaultSubProvider] : null

    onChange({
      providerSlug: slug,
      model: subMeta?.defaultModel || defaultModel,
      apiKey: storedKey,
      baseURL: subMeta?.baseURL || defaultBaseURL,
      subProvider: defaultSubProvider,
      proxyBaseUrl: storedProxyUrl,
    })
  }

  function handleApiKeyBlur(value) {
    localStorage.setItem(`apiKey_${settings.providerSlug}`, value)
  }

  function handleBaseURLBlur(value) {
    const slug = settings.providerSlug
    if (slug === 'custom' || slug === 'ollama') {
      localStorage.setItem(`baseURL_${slug}`, value)
    }
  }

  function handleProxyBaseUrlBlur(value) {
    // M-5 fix: persist the proxy URL so it survives provider switches
    localStorage.setItem(`proxyBaseUrl_${settings.providerSlug}`, value)
  }

  function handleSubProviderChange(sub) {
    const subMeta = providerMeta.subProviders?.[sub] || {}
    setDiscoveredModels([])
    setConnStatus(IDLE)
    onChange({
      subProvider: sub,
      baseURL: subMeta.baseURL || '',
      model: subMeta.defaultModel || '',
    })
  }

  // ── Shared discovered models list ─────────────────────────────────────────
  function DiscoveredModelList() {
    if (connStatus !== OK || discoveredModels.length === 0) return null
    return (
      <div className="mt-2">
        <p className="text-xs text-ink-3 mb-1.5">Click a model to select it:</p>
        <div className="border border-line rounded-lg overflow-hidden divide-y divide-line max-h-48 overflow-y-auto scrollbar-thin">
          {discoveredModels.map((modelId) => {
            const isSelected = settings.model === modelId
            return (
              <button
                key={modelId}
                onClick={() => onChange({ model: modelId })}
                className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'bg-brand-soft text-brand-ink font-medium'
                    : 'text-ink-2 hover:bg-surface-2'
                }`}
              >
                <span className="truncate font-mono">{modelId}</span>
                {isSelected && (
                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-brand-ink" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Refresh button (compact, shown in model section header) ───────────────
  function RefreshButton({ disabled: extraDisabled }) {
    const isDisabled = connStatus === LOADING || extraDisabled
    return (
      <button
        onClick={handleFetchModels}
        disabled={isDisabled}
        title="Fetch available models from the provider"
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          connStatus === OK
            ? 'border-ok-line text-ok-ink bg-ok-soft hover:bg-ok-soft'
            : connStatus === ERROR
            ? 'border-bad-line text-bad-ink bg-bad-soft hover:bg-bad-soft'
            : 'border-line text-ink-3 hover:border-line-strong bg-surface'
        }`}
      >
        {connStatus === LOADING ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        {connStatus === OK
          ? `${discoveredModels.length} model${discoveredModels.length !== 1 ? 's' : ''}`
          : connStatus === LOADING
          ? 'Fetching…'
          : 'Refresh models'}
      </button>
    )
  }

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <div className="p-4 space-y-5 border-t border-line">
      <h2 className="text-sm font-semibold text-ink-2 uppercase tracking-wide">Settings</h2>

      {/* Provider selector */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-1">LLM Provider</label>
        <select
          value={settings.providerSlug}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
        >
          {Object.entries(PROVIDERS).map(([slug, meta]) => (
            <option key={slug} value={slug}>{meta.label}</option>
          ))}
        </select>
      </div>

      {/* Mock provider info banner */}
      {isMock && (
        <div className="bg-ok-soft border border-ok-line rounded-lg p-3 text-xs text-ok-ink">
          <p className="font-semibold mb-1">Simulation mode</p>
          <p>No API key or server needed. Pairs are generated locally from your document text — useful for testing the workflow and UI without any credentials.</p>
        </div>
      )}

      {/* Anthropic CORS warning */}
      {isAnthropic && (
        <div className="bg-warn-soft border border-warn-line rounded-lg p-3 text-xs text-warn-ink">
          <p className="font-semibold mb-1">⚠️ CORS restriction</p>
          <p>Anthropic's API blocks direct browser requests. Enter a CORS proxy URL below (e.g. <code className="bg-warn-soft px-1 rounded">http://localhost:8080/https://api.anthropic.com</code>) or use Google Gemini / Ollama instead.</p>
        </div>
      )}

      {/* Anthropic proxy URL */}
      {isAnthropic && (
        <div>
          <label className="block text-xs font-medium text-ink-3 mb-1">Proxy URL (optional)</label>
          <input
            type="text"
            value={settings.proxyBaseUrl || ''}
            onChange={(e) => onChange({ proxyBaseUrl: e.target.value })}
            onBlur={(e) => handleProxyBaseUrlBlur(e.target.value)}
            placeholder="http://localhost:8080/https://api.anthropic.com"
            className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      )}

      {/* Ollama setup instructions */}
      {isOllama && (
        <div className="bg-surface-2 border border-line rounded-lg p-3 text-xs text-ink-2 space-y-1">
          <p className="font-semibold">Ollama setup</p>
          <p>1. Start Ollama: <code className="bg-surface-3 px-1 rounded">ollama serve</code></p>
          <p>2. Set env var: <code className="bg-surface-3 px-1 rounded">OLLAMA_ORIGINS=*</code></p>
          <p>3. Pull a model: <code className="bg-surface-3 px-1 rounded">ollama pull llama3.2</code></p>
        </div>
      )}

      {/* Custom endpoint note */}
      {isCustom && (
        <div className="bg-surface-2 border border-line rounded-lg p-3 text-xs text-ink-2">
          <p className="font-semibold mb-1">Custom endpoint</p>
          <p>Include <code className="bg-surface-3 px-1 rounded">/v1</code> in the URL, e.g. <code className="bg-surface-3 px-1 rounded">http://host:8000/v1</code>. In dev mode CORS is proxied automatically.</p>
        </div>
      )}

      {/* Base URL + Test Connection (Custom / Ollama only) */}
      {showConnectionTest && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-ink-3">
              Base URL {isOllama ? '' : '(required)'}
            </label>
            {connStatus === OK && (
              <span className="flex items-center gap-1 text-xs text-ok-ink font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Connected · {discoveredModels.length} {discoveredModels.length === 1 ? 'model' : 'models'}
              </span>
            )}
            {connStatus === ERROR && (
              <span className="flex items-center gap-1 text-xs text-bad font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Failed
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={settings.baseURL || ''}
              onChange={(e) => onChange({ baseURL: e.target.value })}
              onBlur={(e) => handleBaseURLBlur(e.target.value)}
              placeholder={isOllama ? 'http://localhost:11434/v1' : 'http://host:8000/v1'}
              className="flex-1 text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              onClick={handleFetchModels}
              disabled={!settings.baseURL || connStatus === LOADING}
              title="Test connection and list available models"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                connStatus === LOADING
                  ? 'border-line text-ink-3 bg-surface-2 cursor-wait'
                  : connStatus === OK
                  ? 'border-ok-line text-ok-ink bg-ok-soft hover:bg-ok-soft'
                  : connStatus === ERROR
                  ? 'border-bad-line text-bad-ink bg-bad-soft hover:bg-bad-soft'
                  : 'border-line text-ink-2 bg-surface hover:bg-surface-2'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {connStatus === LOADING ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              {connStatus === LOADING ? 'Testing…' : connStatus === OK ? 'Re-test' : 'Test'}
            </button>
          </div>

          {connStatus === ERROR && (
            <p className="mt-1.5 text-xs text-bad-ink bg-bad-soft border border-bad-line rounded-lg px-3 py-2">
              {connError || 'Could not reach the endpoint. Check the URL and that the server is running.'}
            </p>
          )}

          <DiscoveredModelList />

          {connStatus === OK && discoveredModels.length === 0 && (
            <p className="mt-1.5 text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-lg px-3 py-2">
              Connected, but the server returned no models. Enter the model name manually below.
            </p>
          )}
        </div>
      )}

      {/* Meta API host selector */}
      {isMeta && hasBaseURLOptions && (
        <div>
          <label className="block text-xs font-medium text-ink-3 mb-1">API Host</label>
          <select
            value={settings.baseURL || providerMeta.baseURLOptions[0].value}
            onChange={(e) => onChange({ baseURL: e.target.value })}
            className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {providerMeta.baseURLOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Chinese sub-provider (Qwen vs DeepSeek) */}
      {isChinese && (
        <div>
          <label className="block text-xs font-medium text-ink-3 mb-1">Sub-provider</label>
          <div className="flex gap-3">
            {Object.entries(providerMeta.subProviders || {}).map(([key, sub]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-sm text-ink-2">
                <input
                  type="radio"
                  name="subProvider"
                  value={key}
                  checked={settings.subProvider === key}
                  onChange={() => handleSubProviderChange(key)}
                  className="text-brand-ink"
                />
                {sub.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* API Key — hidden for Mock */}
      {!isMock && (providerMeta.requiresApiKey || isCustom) && (
        <div>
          <label className="block text-xs font-medium text-ink-3 mb-1">
            API Key {!providerMeta.requiresApiKey && <span className="text-ink-3">(optional)</span>}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey || ''}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              onBlur={(e) => handleApiKeyBlur(e.target.value)}
              placeholder="sk-…"
              className="w-full text-sm border border-line rounded-lg px-3 py-2 pr-9 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2"
              tabIndex={-1}
            >
              {showApiKey ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Model selector — hidden for Mock */}
      {!isMock && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-ink-3">Model</label>
            {/* Refresh button for all providers that support model listing */}
            {canFetchModels && !showConnectionTest && (
              <RefreshButton disabled={!settings.apiKey && !isOllama} />
            )}
          </div>

          {hasFreeTextModel ? (
            <input
              type="text"
              value={settings.model || ''}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder={isOllama ? 'llama3.2' : 'model-name'}
              className={`w-full text-sm border rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand ${
                connStatus === OK && discoveredModels.length > 0 && !settings.model
                  ? 'border-warn-line bg-warn-soft'
                  : 'border-line'
              }`}
            />
          ) : (
            <select
              value={settings.model || ''}
              onChange={(e) => onChange({ model: e.target.value })}
              className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {/* Prefer discovered models; fall back to registry static list */}
              {(discoveredModels.length > 0
                ? discoveredModels
                : isChinese
                ? providerMeta.subProviders?.[settings.subProvider]?.models || []
                : providerMeta.models || []
              ).map((m) => (
                <option key={m} value={m}>{m.split('/').pop()}</option>
              ))}
            </select>
          )}

          {/* Error detail for non-connection-test providers */}
          {!showConnectionTest && connStatus === ERROR && (
            <p className="mt-1.5 text-xs text-bad-ink bg-bad-soft border border-bad-line rounded-lg px-3 py-2">
              {connError || 'Could not fetch models. Check your API key.'}
            </p>
          )}
        </div>
      )}

      {/* Pair count */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs font-medium text-ink-3">Pairs to generate</label>
          <span className="text-xs font-semibold text-brand-ink">{settings.pairCount}</span>
        </div>
        <input
          type="range"
          min="5"
          max="10000"
          value={settings.pairCount}
          onChange={(e) => onChange({ pairCount: Number(e.target.value) })}
          className="w-full accent-brand"
        />
        <div className="flex justify-between text-xs text-ink-3 mt-0.5">
          <span>5</span>
          <span>10 000</span>
        </div>
        {settings.pairCount > 1000 && (
          <p className="text-xs text-warn-ink bg-warn-soft border border-warn-line rounded-lg px-3 py-2 mt-2">
            ⚡ Large output mode — pairs will be saved directly to a file instead of displayed on screen to prevent UI freezing.
          </p>
        )}
      </div>

      {/* Style */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-2">Generation style</label>
        <div className="space-y-2">
          {[
            { value: 'factual', label: 'Factual Q&A', desc: 'Who, what, when, where, why' },
            { value: 'instruction', label: 'Instruction-following', desc: 'Task-based prompts' },
          ].map(({ value, label, desc }) => {
            const isChecked = settings.styles.includes(value)
            const isLastOne = isChecked && settings.styles.length === 1
            return (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isLastOne}
                  onChange={() => {
                    if (isChecked) {
                      onChange({ styles: settings.styles.filter((s) => s !== value) })
                    } else {
                      onChange({ styles: [...settings.styles, value] })
                    }
                  }}
                  className="mt-0.5 w-4 h-4 text-brand-ink rounded border-line-strong"
                />
                <div>
                  <div className="text-sm text-ink-2">{label}</div>
                  <div className="text-xs text-ink-3">{desc}</div>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-1">Difficulty</label>
        <select
          value={settings.difficulty}
          onChange={(e) => onChange({ difficulty: e.target.value })}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value="basic">Basic</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {/* Temperature */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-2">Temperature</label>
        <div className="flex gap-2">
          {[
            { value: 'low', label: 'Low', hint: '0.3' },
            { value: 'balanced', label: 'Balanced', hint: '0.7' },
            { value: 'creative', label: 'Creative', hint: '1.0' },
          ].map(({ value, label, hint }) => (
            <label
              key={value}
              className={`flex-1 flex flex-col items-center gap-0.5 cursor-pointer px-2 py-2 rounded-lg border text-xs transition-colors ${
                settings.temperatureHint === value
                  ? 'border-brand bg-brand-soft text-brand-ink'
                  : 'border-line text-ink-3 hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="temperature"
                value={value}
                checked={settings.temperatureHint === value}
                onChange={() => onChange({ temperatureHint: value })}
                className="sr-only"
              />
              <span className="font-medium">{label}</span>
              <span className="text-ink-3">{hint}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Domain tag */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-1">
          Domain tag <span className="text-ink-3 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={settings.domainTag || ''}
          onChange={(e) => onChange({ domainTag: e.target.value })}
          placeholder="e.g. medical, legal, customer support"
          className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Parallel chunk requests */}
      <div>
        <label className="block text-xs font-medium text-ink-3 mb-1">
          Parallel requests{' '}
          <span className="text-ink-3 font-normal">(large docs)</span>
        </label>
        <select
          value={settings.concurrency || 3}
          onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
          className="w-full text-sm border border-line rounded-lg px-3 py-2 text-ink-2 focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <option value={1}>1 — Sequential (avoid rate limits)</option>
          <option value={2}>2 — Conservative</option>
          <option value={3}>3 — Balanced (default)</option>
          <option value={4}>4 — Fast</option>
          <option value={5}>5 — Aggressive</option>
          <option value={8}>8 — High (local/Ollama)</option>
          <option value={10}>10 — Maximum (local only)</option>
        </select>
        <p className="mt-1 text-xs text-ink-3">
          All files process in parallel — chunks share one pool. Higher = faster, but cloud APIs may rate-limit.
        </p>
      </div>
    </div>
  )
}
