/**
 * Abstract base class for all LLM provider adapters.
 * Subclasses must define a static `slug` string and override `complete()`.
 */
export default class LLMProvider {
  constructor(settings = {}) {
    this.settings = settings
    // Load persisted API key for this provider from localStorage
    const slug = this.constructor.slug
    this.apiKey = settings.apiKey || (slug ? localStorage.getItem(`apiKey_${slug}`) || '' : '')
  }

  /**
   * Send messages to the LLM and return the response text.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} generationSettings - includes temperature, model, etc.
   * @returns {Promise<string>}
   */
  async complete(messages, generationSettings) {
    throw new Error(`complete() must be implemented by ${this.constructor.name}`)
  }

  /** Persist API key to localStorage keyed by provider slug. */
  saveApiKey(key) {
    const slug = this.constructor.slug
    if (slug) localStorage.setItem(`apiKey_${slug}`, key)
    this.apiKey = key
  }

  /** Load API key from localStorage (called on mount or provider switch). */
  static loadApiKey() {
    return localStorage.getItem(`apiKey_${this.slug}`) || ''
  }

  /** Helper: throw a well-formatted error from a non-ok HTTP response. */
  async _throwHttpError(response) {
    let body = ''
    try {
      body = await response.text()
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${response.status} from ${this.constructor.name}: ${body}`)
  }
}
