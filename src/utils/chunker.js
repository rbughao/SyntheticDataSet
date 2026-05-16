/**
 * Document chunker — splits large text into overlapping segments at semantic
 * boundaries so each LLM call receives coherent, manageable context.
 *
 * Boundary priority (best to worst):
 *   1. Paragraph break (\n\n)
 *   2. Sentence end (. ! ? followed by space or newline)
 *   3. Word boundary (space)
 *   4. Hard character cut (last resort)
 *
 * Each chunk overlaps the previous one by `overlap` characters so context
 * at chunk boundaries is not lost.
 */

export const CHUNK_SIZE = 4000    // characters per chunk (~1k tokens of content)
export const CHUNK_OVERLAP = 300  // characters of shared context between chunks

/**
 * Split `text` into overlapping chunks with semantic boundaries.
 * @returns {Array<{ text: string, index: number, total: number }>}
 */
export function chunkDocument(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length === 0) return [{ text: '', index: 0, total: 1 }]
  if (text.length <= chunkSize) return [{ text, index: 0, total: 1 }]

  const rawChunks = []
  let start = 0

  while (start < text.length) {
    const end = start + chunkSize

    if (end >= text.length) {
      // Last segment — take everything remaining
      rawChunks.push(text.slice(start))
      break
    }

    // Search window: last 20% of the chunk window is where we look for a break
    const searchFrom = start + Math.floor(chunkSize * 0.8)
    let breakAt = -1

    // 1. Paragraph boundary
    const paraIdx = text.lastIndexOf('\n\n', end)
    if (paraIdx >= searchFrom) {
      breakAt = paraIdx + 2 // skip past the blank line
    }

    // 2. Sentence boundary
    if (breakAt === -1) {
      const sentenceDelimiters = ['. ', '! ', '? ', '.\n', '!\n', '?\n']
      for (const delim of sentenceDelimiters) {
        const idx = text.lastIndexOf(delim, end)
        if (idx >= searchFrom) {
          breakAt = idx + delim.length
          break
        }
      }
    }

    // 3. Word boundary (last space)
    if (breakAt === -1) {
      const spaceIdx = text.lastIndexOf(' ', end)
      if (spaceIdx >= searchFrom) {
        breakAt = spaceIdx + 1
      }
    }

    // 4. Hard cut
    if (breakAt === -1) breakAt = end

    rawChunks.push(text.slice(start, breakAt))

    // Overlap: next chunk starts `overlap` chars before the current break point
    start = Math.max(start + 1, breakAt - overlap)
  }

  const total = rawChunks.length
  return rawChunks.map((t, i) => ({ text: t, index: i, total }))
}

/**
 * Estimate the number of chunks a text would produce without running the
 * full split (used for the UI preview in DocumentPanel).
 */
export function estimateChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length <= chunkSize) return 1
  const effectiveStep = chunkSize - overlap
  return Math.ceil((text.length - overlap) / effectiveStep)
}
