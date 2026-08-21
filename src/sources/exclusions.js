import { SUPPORTED_TYPES } from '../utils/fileReader.js'

/**
 * Exclusion rules for bulk (folder) ingestion.
 *
 * This app's whole purpose is sending document text to a third-party LLM API.
 * A folder picker that happily reads .env, id_rsa, and credentials.json turns
 * a convenience feature into a credential-exfiltration path — so secrets are
 * excluded by default and the user has to opt in per-file to override.
 *
 * Every exclusion is reported rather than silently applied, so nothing
 * disappears without the user being able to see why.
 */

/** Largest single file we will read into memory, in bytes. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

export const REASON = {
  SECRET: 'secret',
  NOISE: 'noise',
  UNSUPPORTED: 'unsupported',
  TOO_LARGE: 'too-large',
  EMPTY: 'empty',
}

export const REASON_LABEL = {
  [REASON.SECRET]: 'Possible secret',
  [REASON.NOISE]: 'Build or VCS directory',
  [REASON.UNSUPPORTED]: 'Unsupported type',
  [REASON.TOO_LARGE]: 'Too large',
  [REASON.EMPTY]: 'Empty file',
}

// Directory names that never contain source material worth training on, and
// which routinely contain thousands of files.
const NOISE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit', '.parcel-cache',
  '.cache', '.turbo', '.gradle', '.idea', '.vscode', 'coverage', '.terraform',
  'Pods', 'DerivedData', '.DS_Store',
])

// Directories that hold credentials by convention.
const SECRET_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker'])

// Filenames that are secrets regardless of extension.
const SECRET_NAMES = [
  /^\.env(\..*)?$/i,
  /^\.?netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.git-credentials$/i,
  /^credentials(\.json|\.yml|\.yaml)?$/i,
  /^secrets?\.(json|ya?ml|toml|ini|txt)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^known_hosts$/i,
  /^service[-_]?account.*\.json$/i,
  /^.*[-_.](secret|secrets|credential|credentials|token|password)s?\.(json|ya?ml|toml|ini|txt|env)$/i,
]

// Extensions that carry keys or certificates.
const SECRET_EXTS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.asc', '.gpg', '.kdbx', '.ppk',
])

function ext(name) {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

/**
 * Classify one file by its relative path.
 * @returns {{ excluded: boolean, reason?: string, detail?: string }}
 */
export function classify({ path, name, size }) {
  const segments = path.split('/').filter(Boolean)
  const dirs = segments.slice(0, -1)
  const e = ext(name)

  // Directory-level rules first — they explain whole subtrees at once
  for (const d of dirs) {
    if (SECRET_DIRS.has(d)) {
      return { excluded: true, reason: REASON.SECRET, detail: `inside ${d}/` }
    }
    if (NOISE_DIRS.has(d)) {
      return { excluded: true, reason: REASON.NOISE, detail: `inside ${d}/` }
    }
  }

  if (SECRET_EXTS.has(e)) {
    return { excluded: true, reason: REASON.SECRET, detail: `${e} key or certificate` }
  }
  for (const re of SECRET_NAMES) {
    if (re.test(name)) {
      return { excluded: true, reason: REASON.SECRET, detail: name }
    }
  }

  if (size === 0) return { excluded: true, reason: REASON.EMPTY }
  if (size > MAX_FILE_BYTES) {
    return {
      excluded: true,
      reason: REASON.TOO_LARGE,
      detail: `${(size / 1024 / 1024).toFixed(1)} MB`,
    }
  }

  // Extensionless well-known text files are readable even without a suffix
  const isKnownExtensionless = /^(dockerfile|makefile|rakefile|gemfile|procfile)$/i.test(name)
  if (!SUPPORTED_TYPES.includes(e) && !isKnownExtensionless) {
    return { excluded: true, reason: REASON.UNSUPPORTED, detail: e || 'no extension' }
  }

  return { excluded: false }
}

/**
 * Partition a candidate list into included and excluded, with a per-reason tally.
 *
 * @param {Array<{ path, name, size }>} items
 * @returns {{ included: Array, excluded: Array, counts: Record<string, number> }}
 */
export function partition(items) {
  const included = []
  const excluded = []
  const counts = {}

  for (const item of items) {
    const verdict = classify(item)
    if (verdict.excluded) {
      counts[verdict.reason] = (counts[verdict.reason] || 0) + 1
      excluded.push({ ...item, ...verdict })
    } else {
      included.push(item)
    }
  }

  return { included, excluded, counts }
}
