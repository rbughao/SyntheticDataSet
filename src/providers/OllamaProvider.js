import OpenAICompatibleProvider from './OpenAICompatibleProvider.js'

/**
 * Adapter for locally-running Ollama (OpenAI-compatible endpoint).
 *
 * No API key is needed. The user must:
 *   1. Have Ollama running (`ollama serve`)
 *   2. Set OLLAMA_ORIGINS=* before starting Ollama so the browser's
 *      origin (e.g. http://localhost:5173) is permitted.
 *   3. Pull the desired model (`ollama pull llama3.2`)
 *
 * Connection refused errors indicate Ollama is not running or the port
 * is wrong — the UI surfaces setup instructions in this case.
 */
export default class OllamaProvider extends OpenAICompatibleProvider {
  static slug = 'ollama'

  constructor(settings = {}) {
    super(settings)
    this.baseURL = settings.baseURL || 'http://localhost:11434/v1'
    // Ollama requires no API key; clear any inherited value
    this.apiKey = ''
  }
}
