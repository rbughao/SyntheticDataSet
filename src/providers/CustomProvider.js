import OpenAICompatibleProvider from './OpenAICompatibleProvider.js'

/**
 * Adapter for any user-specified OpenAI-compatible endpoint.
 * Use cases: vLLM, LM Studio, text-generation-webui, private deployments.
 *
 * The user provides baseURL, an optional API key, and a model name via the UI.
 */
export default class CustomProvider extends OpenAICompatibleProvider {
  static slug = 'custom'

  constructor(settings = {}) {
    super(settings)
    this.baseURL = settings.baseURL || ''
  }
}
