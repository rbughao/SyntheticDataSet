import LLMProvider from './LLMProvider.js'

/**
 * Adapter for Google Gemini (Generative Language API).
 *
 * Differences from OpenAI format:
 *   - Endpoint encodes the model name in the URL path.
 *   - Auth via `?key=` query param (no Authorization header).
 *   - System instruction is a separate top-level field.
 *   - Response lives in data.candidates[0].content.parts[0].text.
 *
 * Google's API sends CORS headers, so direct browser calls work fine.
 */
export default class GoogleProvider extends LLMProvider {
  static slug = 'google'

  async complete(messages, generationSettings = {}) {
    const { model, temperature, maxTokens } = generationSettings
    const resolvedModel = model || this.settings.model || 'gemini-2.5-pro'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${this.apiKey}`

    const systemMessage = messages.find((m) => m.role === 'system')
    const userMessages = messages.filter((m) => m.role !== 'system')

    const body = {
      ...(systemMessage && {
        system_instruction: { parts: [{ text: systemMessage.content }] },
      }),
      contents: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens || 4096,
      },
    }

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`Network error calling Google Gemini: ${err.message}`)
    }

    if (!response.ok) await this._throwHttpError(response)

    const data = await response.json()
    return data.candidates[0].content.parts[0].text
  }
}
