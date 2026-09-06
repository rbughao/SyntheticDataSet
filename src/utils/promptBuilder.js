import { describePersona } from './personas.js'

const TEMPERATURE_MAP = { low: 0.3, balanced: 0.7, creative: 1.0 }
const MAX_DOC_CHARS = 6000

/**
 * The persona instruction block.
 *
 * Steers both halves of the pair. Two rules earn their place:
 *
 *  - the answer must be written *for* the persona but must never name them.
 *    Without that, outputs start "As a new employee, you should…", which is
 *    an artefact of the generator rather than knowledge, and it poisons the
 *    dataset.
 *  - the persona changes what is asked, not what is true. It must not become
 *    licence to invent facts the excerpt does not contain.
 */
function personaBlock(persona) {
  if (!persona) return ''
  return `
${describePersona(persona)}

Write every question the way this person would actually ask it — their
vocabulary, their priorities, their blind spots. Someone new to a subject asks
different questions than a specialist, and needs different things from the
answer.

Write every answer as the best possible response to this person: pitched at
what they already know, addressing what they actually need, in a register that
suits their situation.

Two constraints:
- Never name or address the persona in the text. Do not write "as a developer"
  or "for your audit" — the reader is already that person. Write the answer,
  not a note about who it is for.
- The persona changes which questions are asked and how answers are framed. It
  never changes the facts. Everything must still be grounded in the excerpt.
`
}

const STYLE_DESCRIPTIONS = {
  factual:
    'Factual Q&A — questions about specific facts in the document (who, what, when, where, why, how many)',
  instruction:
    'Instruction-following — task-based prompts where the document content informs a helpful, detailed response',
}

const DIFFICULTY_GUIDANCE = {
  basic: 'Keep questions simple and direct. Answers should be concise (1-3 sentences).',
  intermediate:
    'Use moderately complex questions that require understanding relationships in the document. Answers should be 2-5 sentences.',
  advanced:
    'Use nuanced, multi-part questions that require synthesis across the document. Answers should be thorough and specific.',
}

/**
 * Build messages for a single document chunk (multi-chunk generation path).
 * pairsForChunk: how many pairs to request from this excerpt.
 * chunkIndex / totalChunks: position context included in the prompt.
 */
export function buildChunkMessages(chunk, chunkIndex, totalChunks, pairsForChunk, settings, persona = null) {
  const { styles, difficulty, domainTag, temperatureHint } = settings

  const styleList = styles.map((s) => STYLE_DESCRIPTIONS[s]).join('\n  - ')
  const difficultyGuide = DIFFICULTY_GUIDANCE[difficulty] || DIFFICULTY_GUIDANCE.intermediate
  const domainNote = domainTag ? `Domain/context tag: "${domainTag}".` : ''

  const systemPrompt = `You are a dataset generation assistant for AI fine-tuning.

Your task: read the provided document excerpt and generate high-quality question-answer pairs for supervised fine-tuning of language models.

CRITICAL OUTPUT RULE: Return ONLY a raw JSON array. Do NOT include markdown code fences (\`\`\`json). Do NOT include any explanation, preamble, or text before or after the array.

Output format:
[
  { "instruction": "<the question or task prompt>", "output": "<the complete answer>", "type": "factual|instruction" }
]

Quality requirements:
- Every answer must be complete, specific, and grounded in this excerpt only. Do not hallucinate.
- Never reference the source (avoid "According to the document…"). Write answers as standalone knowledge.
- Vary question phrasing. Avoid starting every question with the same word.
- The "type" field must be exactly "factual" or "instruction".
${personaBlock(persona)}`

  const userPrompt = `Generate exactly ${pairsForChunk} question-answer pairs from this document excerpt (part ${chunkIndex + 1} of ${totalChunks}).${persona ? `

Every pair must be written from the point of view of: ${persona.name}.` : ''}

Style(s) to use:
  - ${styleList}
${styles.length > 1 ? 'Mix both styles across the pairs.' : ''}

Difficulty level: ${difficulty}
${difficultyGuide}
${domainNote}

---
DOCUMENT EXCERPT:
${chunk.text}
---

Remember: return ONLY the raw JSON array, nothing else.`

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: TEMPERATURE_MAP[temperatureHint] ?? 0.7,
  }
}

/**
 * Build the messages array for any LLM provider (single-document path).
 * Returns { messages, temperature }.
 * The temperature float is returned separately for the caller to pass to complete().
 */
export function buildMessages(document, settings, persona = null) {
  const { pairCount, styles, difficulty, domainTag, temperatureHint } = settings

  const styleList = styles.map((s) => STYLE_DESCRIPTIONS[s]).join('\n  - ')
  const difficultyGuide = DIFFICULTY_GUIDANCE[difficulty] || DIFFICULTY_GUIDANCE.intermediate
  const domainNote = domainTag ? `Domain/context tag: "${domainTag}".` : ''

  const systemPrompt = `You are a dataset generation assistant for AI fine-tuning.

Your task is to read a source document and generate high-quality question-answer pairs suitable for supervised fine-tuning of language models.

CRITICAL OUTPUT RULE: Return ONLY a raw JSON array. Do NOT include markdown code fences (\`\`\`json). Do NOT include any explanation, preamble, or text before or after the JSON array.

Output format — a JSON array of objects:
[
  { "instruction": "<the question or task prompt>", "output": "<the complete answer>", "type": "factual|instruction" }
]

Quality requirements:
- Every answer must be complete, specific, and fully grounded in the document. Do not hallucinate.
- Never reference the document itself (e.g., avoid "According to the document..."). Write answers as standalone knowledge.
- Vary question phrasing. Avoid starting every question with the same word.
- The "type" field must be exactly "factual" or "instruction".
${personaBlock(persona)}`

  // Truncate document if too long
  let docText = document.text
  let truncationNote = ''
  if (docText.length > MAX_DOC_CHARS) {
    docText = docText.slice(0, MAX_DOC_CHARS)
    truncationNote = '\n\n[... document truncated for length ...]'
  }

  const userPrompt = `Generate exactly ${pairCount} question-answer pairs from the document below.${persona ? `

Every pair must be written from the point of view of: ${persona.name}.` : ''}

Style(s) to use:
  - ${styleList}
${styles.length > 1 ? 'Mix both styles across the pairs.' : ''}

Difficulty level: ${difficulty}
${difficultyGuide}
${domainNote}

---
DOCUMENT:
${docText}${truncationNote}
---

Remember: return ONLY the raw JSON array, nothing else.`

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: TEMPERATURE_MAP[temperatureHint] ?? 0.7,
  }
}
