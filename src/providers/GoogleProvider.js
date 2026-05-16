import LLMProvider from './LLMProvider.js'

/**
 * Adapter for Google Gemini (Generative Language API).
 *
 * Differences from OpenAI format:
 *   - Endpoint encodes the model name in the URL path.
 *   - Auth via `x-goog-api-key` header (NOT a `?key=` query param — that
 *     would expose the key in server logs and browser network history).
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`

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
        headers: {
          'Content-Type': 'application/json',
          // Key in a header — never in a query param (logs, referrer headers, etc.)
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`Network error calling Google Gemini: ${err.message}`)
    }

    if (!response.ok) await this._throwHttpError(response)

    const data = await response.json()

    // Safety-filter or empty response guard
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason
      const blockReason = data?.promptFeedback?.blockReason
      const reason = finishReason || blockReason || 'unknown'
      throw new Error(`Empty or filtered response from Google Gemini (reason: ${reason})`)
    }

    return text
  }
}
