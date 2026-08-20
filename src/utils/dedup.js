// ---------------------------------------------------------------------------
// Duplicate detection
//
// Chunks overlap by CHUNK_OVERLAP characters by design, so the same passage is
// shown to the model more than once. Near-duplicate pairs are therefore a
// structural certainty, not an occasional accident — and duplicate training
// examples cause overfitting during fine-tuning.
//
// Two passes:
//   1. Exact  — normalized instruction string equality (fast, catches most)
//   2. Fuzzy  — trigram Jaccard similarity above a threshold (catches rephrasing)
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Character trigram set for fuzzy comparison. */
function trigrams(text) {
  const s = normalize(text)
  const out = new Set()
  if (s.length < 3) {
    if (s) out.add(s)
    return out
  }
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3))
  return out
}

/** Jaccard similarity of two sets: |A ∩ B| / |A ∪ B|. */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.85

/**
 * Find duplicate pairs. The FIRST occurrence of each group is kept;
 * every later member is reported as a duplicate.
 *
 * Fuzzy comparison is O(n²) so it is skipped above `fuzzyLimit` pairs —
 * exact matching still runs on the full set at any size.
 *
 * @param {Array} pairs
 * @param {object} [opts]
 * @param {number} [opts.threshold]  Jaccard cutoff (0–1)
 * @param {boolean} [opts.fuzzy]     Enable trigram pass
 * @param {number} [opts.fuzzyLimit] Max pairs for the O(n²) pass
 * @returns {{
 *   duplicateIds: Set<string>,
 *   groups: Array<{ keepId: string, duplicateIds: string[], kind: 'exact'|'fuzzy' }>,
 *   exactCount: number, fuzzyCount: number, fuzzySkipped: boolean
 * }}
 */
export function findDuplicates(pairs, opts = {}) {
  const {
    threshold = DEFAULT_SIMILARITY_THRESHOLD,
    fuzzy = true,
    fuzzyLimit = 2000,
  } = opts

  const duplicateIds = new Set()
  const groups = []
  let exactCount = 0
  let fuzzyCount = 0

  // ── Pass 1: exact normalized-instruction match ──────────────────────────
  const seen = new Map() // normalizedInstruction -> keepId
  const groupByKeepId = new Map()

  for (const p of pairs) {
    const key = normalize(p.instruction)
    if (!key) continue
    if (seen.has(key)) {
      const keepId = seen.get(key)
      duplicateIds.add(p.id)
      exactCount++
      let g = groupByKeepId.get(keepId)
      if (!g) {
        g = { keepId, duplicateIds: [], kind: 'exact' }
        groupByKeepId.set(keepId, g)
        groups.push(g)
      }
      g.duplicateIds.push(p.id)
    } else {
      seen.set(key, p.id)
    }
  }

  // ── Pass 2: fuzzy trigram similarity on survivors ───────────────────────
  const survivors = pairs.filter((p) => !duplicateIds.has(p.id))
  const fuzzySkipped = fuzzy && survivors.length > fuzzyLimit

  if (fuzzy && !fuzzySkipped) {
    const grams = survivors.map((p) => trigrams(p.instruction))
    for (let i = 0; i < survivors.length; i++) {
      if (duplicateIds.has(survivors[i].id)) continue
      for (let j = i + 1; j < survivors.length; j++) {
        if (duplicateIds.has(survivors[j].id)) continue
        if (jaccard(grams[i], grams[j]) >= threshold) {
          duplicateIds.add(survivors[j].id)
          fuzzyCount++
          const keepId = survivors[i].id
          let g = groupByKeepId.get(keepId)
          if (!g) {
            g = { keepId, duplicateIds: [], kind: 'fuzzy' }
            groupByKeepId.set(keepId, g)
            groups.push(g)
          }
          g.duplicateIds.push(survivors[j].id)
        }
      }
    }
  }

  return { duplicateIds, groups, exactCount, fuzzyCount, fuzzySkipped }
}

/** Convenience: return a new array with all detected duplicates removed. */
export function removeDuplicates(pairs, opts) {
  const { duplicateIds } = findDuplicates(pairs, opts)
  return pairs.filter((p) => !duplicateIds.has(p.id))
}
