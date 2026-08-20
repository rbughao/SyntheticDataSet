/**
 * Document chunker — splits large text into overlapping segments at semantic
 * boundaries so each LLM call receives coherent, manageable context.
 *
 * Two boundary strategies, selected by the document's `kind`:
 *
 *   prose / data (default)      code
 *   ───────────────────────     ─────────────────────────
 *   1. Paragraph break          1. Blank line (block end)
 *   2. Sentence end             2. Line start at column 0 (top-level decl)
 *   3. Word boundary            3. Any line break
 *   4. Hard cut                 4. Hard cut
 *
 * Sentence heuristics are wrong for source code: a period inside `obj.method()`
 * is not a sentence end, so prose rules slice functions in half. Splitting code
 * on line boundaries keeps statements and usually whole blocks intact.
 *
 * Each chunk overlaps the previous one by `overlap` characters so context at
 * chunk boundaries is not lost.
 */

export const CHUNK_SIZE = 4000    // characters per chunk (~1k tokens of content)
export const CHUNK_OVERLAP = 300  // characters of shared context between chunks

/** Find the best break point for prose. Returns -1 when none qualifies. */
function findProseBreak(text, end, searchFrom) {
  // 1. Paragraph boundary
  const paraIdx = text.lastIndexOf('\n\n', end)
  if (paraIdx >= searchFrom) return paraIdx + 2 // skip past the blank line

  // 2. Sentence boundary
  for (const delim of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
    const idx = text.lastIndexOf(delim, end)
    if (idx >= searchFrom) return idx + delim.length
  }

  // 3. Word boundary
  const spaceIdx = text.lastIndexOf(' ', end)
  if (spaceIdx >= searchFrom) return spaceIdx + 1

  return -1
}

/** Find the best break point for source code. Returns -1 when none qualifies. */
function findCodeBreak(text, end, searchFrom) {
  // 1. Blank line — end of a function, class, or logical block
  const blankIdx = text.lastIndexOf('\n\n', end)
  if (blankIdx >= searchFrom) return blankIdx + 2

  // 2. A line starting at column 0 (unindented) is usually a top-level
  //    declaration, which makes a clean seam between definitions.
  for (let i = Math.min(end, text.length - 1); i >= searchFrom; i--) {
    if (text[i] === '\n' && text[i + 1] && text[i + 1] !== ' ' && text[i + 1] !== '\t') {
      return i + 1
    }
  }

  // 3. Any line break
  const nlIdx = text.lastIndexOf('\n', end)
  if (nlIdx >= searchFrom) return nlIdx + 1

  return -1
}

/**
 * Split `text` into overlapping chunks with semantic boundaries.
 *
 * @param {string} text
 * @param {number} [chunkSize]
 * @param {number} [overlap]
 * @param {'prose'|'code'|'data'} [kind]  Selects the boundary strategy
 * @returns {Array<{ text: string, index: number, total: number }>}
 */
export function chunkDocument(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP, kind = 'prose') {
  if (!text || text.length === 0) return [{ text: '', index: 0, total: 1 }]
  if (text.length <= chunkSize) return [{ text, index: 0, total: 1 }]

  const findBreak = kind === 'code' ? findCodeBreak : findProseBreak
  const rawChunks = []
  let start = 0

  while (start < text.length) {
    const end = start + chunkSize

    if (end >= text.length) {
      // Last segment — take everything remaining
      rawChunks.push(text.slice(start))
      break
    }

    // Search window: the last 20% of the chunk is where we look for a break
    const searchFrom = start + Math.floor(chunkSize * 0.8)

    // Fall back to a hard cut when no boundary qualifies
    const found = findBreak(text, end, searchFrom)
    const breakAt = found === -1 ? end : found

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
