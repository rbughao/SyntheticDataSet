import { useState, useEffect } from 'react'
import { PROVIDERS } from '../providers/index.js'
import { proxyFetch } from '../utils/corsProxy.js'

// Status values for the connection test: 'idle' | 'loading' | 'ok' | 'error'
const IDLE = 'idle'
const LOADING = 'loading'
const OK = 'ok'
const ERROR = 'error'

/**
 * Fetch the model list from an OpenAI-compatible /models endpoint.
 * Returns an array of model ID strings sorted alphabetically.
 */
async function fetchModels(baseURL, apiKey) {
  const base = (baseURL || '').replace(/\/+$/, '')
  if (!base) throw new Error('Base URL is empty')

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const res = await proxyFetch(`${base}/models`, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`)
  }

  const data = await res.json()

  // Standard OpenAI format: { data: [{ id, ... }] }
  // Some servers return a plain array instead
  const items = Array.isArray(data) ? data : (data.data ?? [])
  return items
    .map((m) => (typeof m === 'string' ? m : m.id))
    .filter(Boolean)
    .sort()
}

export default function SettingsPanel({ settings, onChange }) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [connStatus, setConnStatus] = useState(IDLE)   // connection test state
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
  const canTestConnection = isCustom || isOllama

  // Reset connection status when the base URL changes so stale results don't linger
  useEffect(() => {
    setConnStatus(IDLE)
    setDiscoveredModels([])
    setConnError('')
  }, [settings.baseURL, settings.providerSlug])

  // When provider changes, reset model to that provider's default and load stored API key + baseURL
  function handleProviderChange(slug) {
    const meta = PROVIDERS[slug] || {}
    const defaultModel = meta.defaultModel || ''
    const storedKey = localStorage.getItem(`apiKey_${slug}`) || ''
    // For Custom and Ollama, restore the previously saved base URL from localStorage
    const storedBaseURL = localStorage.getItem(`baseURL_${slug}`) || ''
    const defaultBaseURL = storedBaseURL || meta.baseURLOptions?.[0]?.value || ''
    const defaultSubProvider = meta.defaultSubProvider || ''
    const subMeta = defaultSubProvider ? meta.subProviders?.[defaultSubProvider] : null

    onChange({
      providerSlug: slug,
      model: subMeta?.defaultModel || defaultModel,
      apiKey: storedKey,
      baseURL: subMeta?.baseURL || defaultBaseURL,
      subProvider: defaultSubProvider,
      proxyBaseUrl: '',
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

  function handleSubProviderChange(sub) {
    const subMeta = providerMeta.subProviders?.[sub] || {}
    onChange({
      subProvider: sub,
      baseURL: subMeta.baseURL || '',
      model: subMeta.defaultModel || '',
    })
  }

  async function handleTestConnection() {
    setConnStatus(LOADING)
    setDiscoveredModels([])
    setConnError('')
    try {
      const models = await fetchModels(settings.baseURL, settings.apiKey)
      setDiscoveredModels(models)
      setConnStatus(OK)
      // If only one model is available and none is selected yet, auto-select it
      if (models.length === 1 && !settings.model) {
        onChange({ model: models[0] })
      }
    } catch (err) {
      setConnStatus(ERROR)
      setConnError(err.message)
    }
  }

  return (
    <div className="p-4 space-y-5 border-t border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Settings</h2>

      {/* Provider selector */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">LLM Provider</label>
        <select
          value={settings.providerSlug}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          {Object.entries(PROVIDERS).map(([slug, meta]) => (
            <option key={slug} value={slug}>{meta.label}</option>
          ))}
        </select>
      </div>

      {/* Mock provider info banner */}
      {isMock && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
          <p className="font-semibold mb-1">Simulation mode</p>
          <p>No API key or server needed. Pairs are generated locally from your document text — useful for testing the workflow and UI without any credentials.</p>
        </div>
      )}

      {/* Anthropic CORS warning */}
      {isAnthropic && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">⚠️ CORS restriction</p>
          <p>Anthropic's API blocks direct browser requests. Enter a CORS proxy URL below (e.g. <code className="bg-amber-100 px-1 rounded">http://localhost:8080/https://api.anthropic.com</code>) or use Google Gemini / Ollama instead.</p>
        </div>
      )}

      {/* Anthropic proxy URL */}
      {isAnthropic && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Proxy URL (optional)</label>
          <input
            type="text"
            value={settings.proxyBaseUrl || ''}
            onChange={(e) => onChange({ proxyBaseUrl: e.target.value })}
            placeholder="http://localhost:8080/https://api.anthropic.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      )}

      {/* Ollama warning */}
      {isOllama && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          <p className="font-semibold">Ollama setup</p>
          <p>1. Start Ollama: <code className="bg-gray-100 px-1 rounded">ollama serve</code></p>
          <p>2. Set env var: <code className="bg-gray-100 px-1 rounded">OLLAMA_ORIGINS=*</code></p>
          <p>3. Pull a model: <code className="bg-gray-100 px-1 rounded">ollama pull llama3.2</code></p>
        </div>
      )}

      {/* Custom CORS note */}
      {isCustom && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
          <p className="font-semibold mb-1">Custom endpoint requirements</p>
          <p>The server must send CORS headers (<code className="bg-gray-100 px-1 rounded">Access-Control-Allow-Origin: *</code>) to allow browser requests.</p>
          <p className="mt-1">Include <code className="bg-gray-100 px-1 rounded">/v1</code> in the URL, e.g. <code className="bg-gray-100 px-1 rounded">http://host:8000/v1</code>.</p>
        </div>
      )}

      {/* Base URL + Test Connection button */}
      {(isCustom || isOllama) && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-500">
              Base URL {isOllama ? '' : '(required)'}
            </label>
            {/* Inline connection status badge */}
            {connStatus === OK && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Connected · {discoveredModels.length} {discoveredModels.length === 1 ? 'model' : 'models'}
              </span>
            )}
            {connStatus === ERROR && (
              <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
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
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={handleTestConnection}
              disabled={!settings.baseURL || connStatus === LOADING}
              title="Test connection and list available models"
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                connStatus === LOADING
                  ? 'border-gray-200 text-gray-400 bg-gray-50 cursor-wait'
                  : connStatus === OK
                  ? 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                  : connStatus === ERROR
                  ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                  : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
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

          {/* Error detail */}
          {connStatus === ERROR && (
            <p className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {connError || 'Could not reach the endpoint. Check the URL and that CORS is enabled on the server.'}
            </p>
          )}

          {/* Discovered model list */}
          {connStatus === OK && discoveredModels.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-400 mb-1.5">Click a model to select it:</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto scrollbar-thin">
                {discoveredModels.map((modelId) => {
                  const isSelected = settings.model === modelId
                  return (
                    <button
                      key={modelId}
                      onClick={() => onChange({ model: modelId })}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-indigo-50 text-indigo-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="truncate font-mono">{modelId}</span>
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 flex-shrink-0 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Connected but no models returned */}
          {connStatus === OK && discoveredModels.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Connected, but the server returned no models. Enter the model name manually below.
            </p>
          )}
        </div>
      )}

      {/* Meta base URL selector */}
      {isMeta && hasBaseURLOptions && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">API Host</label>
          <select
            value={settings.baseURL || providerMeta.baseURLOptions[0].value}
            onChange={(e) => onChange({ baseURL: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
          <label className="block text-xs font-medium text-gray-500 mb-1">Sub-provider</label>
          <div className="flex gap-3">
            {Object.entries(providerMeta.subProviders || {}).map(([key, sub]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                <input
                  type="radio"
                  name="subProvider"
                  value={key}
                  checked={settings.subProvider === key}
                  onChange={() => handleSubProviderChange(key)}
                  className="text-indigo-600"
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
          <label className="block text-xs font-medium text-gray-500 mb-1">
            API Key {!providerMeta.requiresApiKey && <span className="text-gray-400">(optional)</span>}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey || ''}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              onBlur={(e) => handleApiKeyBlur(e.target.value)}
              placeholder="sk-…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-9 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
      {!isMock && <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
        {hasFreeTextModel ? (
          <input
            type="text"
            value={settings.model || ''}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder={isOllama ? 'llama3.2' : 'model-name'}
            className={`w-full text-sm border rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
              // Highlight the model field when discovered models are available but nothing is selected
              connStatus === OK && discoveredModels.length > 0 && !settings.model
                ? 'border-amber-300 bg-amber-50'
                : 'border-gray-200'
            }`}
          />
        ) : (
          <select
            value={settings.model || ''}
            onChange={(e) => onChange({ model: e.target.value })}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {(isChinese
              ? providerMeta.subProviders?.[settings.subProvider]?.models || []
              : providerMeta.models || []
            ).map((m) => (
              <option key={m} value={m}>{m.split('/').pop()}</option>
            ))}
          </select>
        )}
        {/* Hint when model field is empty and we have models to pick from */}
        {hasFreeTextModel && connStatus === OK && discoveredModels.length > 0 && !settings.model && (
          <p className="mt-1 text-xs text-amber-600">Select a model from the list above.</p>
        )}
      </div>}

      {/* Pair count */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Pairs to generate</label>
          <span className="text-xs font-semibold text-indigo-600">{settings.pairCount}</span>
        </div>
        <input
          type="range"
          min="5"
          max="1000"
          value={settings.pairCount}
          onChange={(e) => onChange({ pairCount: Number(e.target.value) })}
          className="w-full accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
          <span>5</span>
          <span>1000</span>
        </div>
      </div>

      {/* Style */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">Generation style</label>
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
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300"
                />
                <div>
                  <div className="text-sm text-gray-700">{label}</div>
                  <div className="text-xs text-gray-400">{desc}</div>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Difficulty</label>
        <select
          value={settings.difficulty}
          onChange={(e) => onChange({ difficulty: e.target.value })}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="basic">Basic</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {/* Temperature */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">Temperature</label>
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
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
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
              <span className="text-gray-400">{hint}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Domain tag */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Domain tag <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={settings.domainTag || ''}
          onChange={(e) => onChange({ domainTag: e.target.value })}
          placeholder="e.g. medical, legal, customer support"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {/* Parallel chunk requests */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Parallel requests{' '}
          <span className="text-gray-400 font-normal">(large docs)</span>
        </label>
        <select
          value={settings.concurrency || 3}
          onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value={1}>1 — Sequential (avoid rate limits)</option>
          <option value={2}>2 — Conservative</option>
          <option value={3}>3 — Balanced (default)</option>
          <option value={4}>4 — Fast</option>
          <option value={5}>5 — Maximum throughput</option>
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Chunks are sent concurrently to the LLM. Higher = faster, but may trigger rate limits.
        </p>
      </div>
    </div>
  )
}
