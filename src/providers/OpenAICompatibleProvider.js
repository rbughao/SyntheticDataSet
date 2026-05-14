import LLMProvider from './LLMProvider.js'
import { proxyFetch } from '../utils/corsProxy.js'

/**
 * Shared adapter for any provider that speaks the OpenAI chat completions API.
 * Subclasses set `this.baseURL` and `this.constructor.slug` appropriately.
 *
 * Uses proxyFetch instead of raw fetch so that in Vite dev mode all requests
 * are routed through the local CORS proxy, fixing "Failed to fetch" errors
 * from servers that don't send Access-Control-Allow-Origin headers.
 */
export default class OpenAICompatibleProvider extends LLMProvider {
  constructor(settings = {}) {
    super(settings)
    // Subclasses override this.baseURL in their own constructor
    this.baseURL = settings.baseURL || this.baseURL || ''
  }

  async complete(messages, generationSettings = {}) {
    const { model, temperature } = generationSettings
    // Strip trailing slash so user-entered URLs like "http://host/v1/" don't produce double slashes
    const base = (this.baseURL || '').replace(/\/+$/, '')
    const url = `${base}/chat/completions`

    const headers = { 'Content-Type': 'application/json' }
    // Only add auth header when an API key is present (Ollama has none)
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const body = {
      model: model || this.settings.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: 4096,
    }

    // Some models (e.g. o3-mini) reject the temperature field
    if (this.settings.model === 'o3-mini' || model === 'o3-mini') {
      delete body.temperature
    }

    let response
    try {
      response = await proxyFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Network-level failure (CORS, connection refused, offline)
      throw new Error(`Network error calling ${this.constructor.name}: ${err.message}`)
    }

    if (!response.ok) await this._throwHttpError(response)

    const data = await response.json()
    return data.choices[0].message.content
  }
}
