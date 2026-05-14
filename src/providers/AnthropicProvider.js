import LLMProvider from './LLMProvider.js'

/**
 * Adapter for Anthropic's Messages API.
 *
 * IMPORTANT — CORS: Anthropic's API does not send CORS headers for browser
 * requests. Direct calls from localhost will be blocked by the browser.
 * Users must either run a local CORS proxy (e.g. cors-anywhere) and provide
 * its URL as `proxyBaseUrl`, or switch to a provider that supports CORS.
 *
 * The Anthropic message format differs from OpenAI:
 *   - System prompt is a top-level `system` string, NOT a message in the array.
 *   - Response text lives in data.content[0].text.
 */
export default class AnthropicProvider extends LLMProvider {
  static slug = 'anthropic'

  constructor(settings = {}) {
    super(settings)
    // Allow a local CORS proxy to be substituted for the real base URL
    this.baseURL = settings.proxyBaseUrl || 'https://api.anthropic.com'
  }

  async complete(messages, generationSettings = {}) {
    const { model, temperature } = generationSettings
    const url = `${this.baseURL}/v1/messages`

    // Anthropic splits the system role out of the messages array
    const systemMessage = messages.find((m) => m.role === 'system')
    const userMessages = messages.filter((m) => m.role !== 'system')

    const body = {
      model: model || this.settings.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemMessage?.content || '',
      messages: userMessages,
      temperature: temperature ?? 0.7,
    }

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`Network error calling Anthropic: ${err.message}`)
    }

    if (!response.ok) await this._throwHttpError(response)

    const data = await response.json()
    return data.content[0].text
  }
}
