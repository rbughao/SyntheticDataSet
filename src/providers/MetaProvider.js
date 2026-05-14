import OpenAICompatibleProvider from './OpenAICompatibleProvider.js'

/**
 * Adapter for Meta Llama models served via OpenAI-compatible hosts.
 * Supports Together.xyz, Fireworks AI, and Groq as base URL options.
 */
export default class MetaProvider extends OpenAICompatibleProvider {
  static slug = 'meta'

  constructor(settings = {}) {
    super(settings)
    // Fall back to Together.xyz if no base URL provided by settings
    this.baseURL = settings.baseURL || 'https://api.together.xyz/v1'
  }
}
