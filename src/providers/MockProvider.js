import LLMProvider from './LLMProvider.js'

/**
 * Offline simulation provider — generates Q&A pairs directly from the
 * document text without any network call or API key.
 *
 * Useful for:
 *   - Testing the full generate → review → export workflow without credentials
 *   - Demoing the app to stakeholders
 *   - Smoke-testing UI changes
 *
 * The algorithm extracts sentences from the document text embedded in the
 * user prompt and wraps them in question/instruction templates. An artificial
 * 800 ms delay makes the loading skeleton visible.
 */
export default class MockProvider extends LLMProvider {
  static slug = 'mock'

  async complete(messages, generationSettings = {}) {
    const userMsg = messages.find((m) => m.role === 'user')?.content || ''

    // Parse how many pairs were requested
    const countMatch = userMsg.match(/Generate exactly (\d+)/)
    const count = countMatch ? parseInt(countMatch[1], 10) : 5

    // Extract the document text block from the prompt
    const docMatch = userMsg.match(/DOCUMENT:\n([\s\S]*?)\n---/)
    const docText = docMatch ? docMatch[1].trim() : 'Sample content for demonstration purposes.'

    // Determine which styles were requested
    const wantInstruction = userMsg.includes('Instruction-following')
    const wantFactual = userMsg.includes('Factual Q&A') || !wantInstruction

    // Split into usable sentences (at least 20 chars after trimming)
    const sentences = docText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20)

    // Fall back to chunking by words if the text has no sentence boundaries
    const pool =
      sentences.length >= 3
        ? sentences
        : chunkWords(docText, 12)

    const pairs = []
    for (let i = 0; i < count; i++) {
      const sentence = pool[i % pool.length]
      const keyPhrase = sentence.split(/\s+/).slice(0, 5).join(' ')

      // Rotate style: factual, factual, instruction (if both requested)
      const useInstruction = wantInstruction && (!wantFactual || i % 3 === 2)

      if (useInstruction) {
        pairs.push({
          instruction: `Explain the following concept in simple terms: "${keyPhrase}..."`,
          output: `${sentence} This is a core idea that provides foundational context for understanding the broader topic.`,
          type: 'instruction',
        })
      } else {
        pairs.push({
          instruction: `What does the text say about "${keyPhrase}"?`,
          output: sentence.endsWith('.') ? sentence : sentence + '.',
          type: 'factual',
        })
      }
    }

    // Simulate API latency so the loading skeleton is visible
    await new Promise((r) => setTimeout(r, 800))

    return JSON.stringify(pairs)
  }
}

function chunkWords(text, wordsPerChunk) {
  const words = text.split(/\s+/)
  const chunks = []
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunk = words.slice(i, i + wordsPerChunk).join(' ')
    if (chunk.length >= 20) chunks.push(chunk)
  }
  return chunks.length ? chunks : [text]
}
