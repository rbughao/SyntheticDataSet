// ---------------------------------------------------------------------------
// Session persistence
//
// Two tiers:
//   • localStorage — generation settings (small, synchronous, read at startup)
//   • IndexedDB    — documents + generated pairs (can be many MB, async)
//
// Without this a page refresh discards every document and every generated pair,
// which for a long run is a lot of lost work and API spend.
// ---------------------------------------------------------------------------

const DB_NAME = 'synthgen'
const DB_VERSION = 1
const STORE = 'session'
const SESSION_KEY = 'current'
const SETTINGS_KEY = 'synthgen_settings'

// API keys stay in their existing per-provider localStorage entries and are
// never written into the session snapshot.
const SETTINGS_BLOCKLIST = new Set(['apiKey'])

// ── localStorage: settings ─────────────────────────────────────────────────

/** Persist generation settings (everything except secrets). */
export function saveSettings(settings) {
  try {
    const safe = {}
    for (const [k, v] of Object.entries(settings)) {
      if (!SETTINGS_BLOCKLIST.has(k)) safe[k] = v
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe))
  } catch {
    // Quota exceeded or storage disabled — settings just won't persist.
  }
}

/** Load persisted settings, or null when nothing is stored. */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearSettings() {
  try { localStorage.removeItem(SETTINGS_KEY) } catch { /* ignore */ }
}

// ── IndexedDB: documents + pairs ───────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'))
  })
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

/**
 * Write a session snapshot. Silently no-ops on failure — persistence must
 * never break the app.
 */
export async function saveSession({ documents, pairs }) {
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').put(
        {
          savedAt: Date.now(),
          documents: documents || [],
          pairs: pairs || [],
        },
        SESSION_KEY
      )
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    db.close()
  } catch {
    // Storage full or blocked — skip silently.
  }
}

/**
 * Read the stored snapshot.
 * @returns {Promise<{ savedAt, documents, pairs } | null>}
 */
export async function loadSession() {
  try {
    const db = await openDB()
    const value = await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').get(SESSION_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!value) return null
    if (!value.documents?.length && !value.pairs?.length) return null
    return value
  } catch {
    return null
  }
}

export async function clearSession() {
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').delete(SESSION_KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    db.close()
  } catch {
    // ignore
  }
}

/** Human-readable "how long ago" for the restore banner. */
export function formatSavedAt(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}
