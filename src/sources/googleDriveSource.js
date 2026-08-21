import { authorizedFetch } from './oauth.js'

/**
 * Google Drive listing and download.
 *
 * Native Google formats are not files and cannot be downloaded — Docs, Sheets
 * and Slides have to be exported to something readable first. Everything else
 * comes down verbatim via alt=media.
 */

const API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Native type → what we export it as, plus the extension readFile expects. */
const EXPORT_AS = {
  'application/vnd.google-apps.document': { mimeType: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'text/csv', ext: '.csv' },
  'application/vnd.google-apps.presentation': { mimeType: 'text/plain', ext: '.txt' },
}

// Drive does not report a size for native docs; give them a nominal one so the
// review step can estimate, and so they aren't filtered out as empty files.
const NATIVE_NOMINAL_BYTES = 4096

/**
 * Accept a folder URL, a "shared with me" link, or a bare ID.
 * Returns null when nothing usable is found.
 */
export function parseFolderId(input) {
  const raw = (input || '').trim()
  if (!raw) return null

  // Bare ID — Drive IDs are long, URL-safe, and contain no slashes
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw

  try {
    const u = new URL(raw)
    if (!/(^|\.)google\.com$/.test(u.hostname)) return null
    const fromPath = u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)
    if (fromPath) return fromPath[1]
    const fromQuery = u.searchParams.get('id')
    if (fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery)) return fromQuery
    return null
  } catch {
    return null
  }
}

/** Append the export extension so classification and readFile see a real type. */
function displayName(file) {
  const exportAs = EXPORT_AS[file.mimeType]
  if (!exportAs) return file.name
  return file.name.toLowerCase().endsWith(exportAs.ext) ? file.name : file.name + exportAs.ext
}

async function listChildren(folderId, pageToken) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, size)',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  if (pageToken) params.set('pageToken', pageToken)

  const res = await authorizedFetch('gdrive', `${API}/files?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Google Drive returned HTTP ${res.status}.`)
  }
  return res.json()
}

/** Confirm a folder exists and get its name, so the UI can say what it found. */
export async function getFolderName(folderId) {
  const res = await authorizedFetch(
    'gdrive',
    `${API}/files/${folderId}?fields=id,name,mimeType&supportsAllDrives=true`
  )
  if (!res.ok) {
    if (res.status === 404) throw new Error('That folder was not found, or your account cannot see it.')
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Google Drive returned HTTP ${res.status}.`)
  }
  const data = await res.json()
  if (data.mimeType !== FOLDER_MIME) throw new Error(`"${data.name}" is a file, not a folder.`)
  return data.name
}

/**
 * Walk a folder tree breadth-first.
 * @returns {Promise<Array<{ id, name, path, size, mimeType, exportAs }>>}
 */
export async function listFolder(folderId, { maxItems = 500, onProgress, cancelRef } = {}) {
  const rootName = await getFolderName(folderId)
  const queue = [{ id: folderId, path: rootName }]
  const out = []

  while (queue.length && out.length < maxItems) {
    if (cancelRef?.current) break
    const folder = queue.shift()
    let pageToken

    do {
      if (cancelRef?.current) break
      const page = await listChildren(folder.id, pageToken)

      for (const file of page.files || []) {
        if (file.mimeType === FOLDER_MIME) {
          queue.push({ id: file.id, path: `${folder.path}/${file.name}` })
          continue
        }
        if (out.length >= maxItems) break
        const exportAs = EXPORT_AS[file.mimeType] || null
        const name = displayName(file)
        out.push({
          id: file.id,
          name,
          path: `${folder.path}/${name}`,
          size: Number(file.size) || (exportAs ? NATIVE_NOMINAL_BYTES : 0),
          mimeType: file.mimeType,
          exportAs,
        })
      }

      onProgress?.({ found: out.length, folders: queue.length, current: folder.path })
      pageToken = page.nextPageToken
    } while (pageToken && out.length < maxItems)
  }

  return out
}

/** Download (or export) one item as a File. */
export async function fetchFile(item) {
  const url = item.exportAs
    ? `${API}/files/${item.id}/export?mimeType=${encodeURIComponent(item.exportAs.mimeType)}`
    : `${API}/files/${item.id}?alt=media&supportsAllDrives=true`

  const res = await authorizedFetch('gdrive', url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Could not download "${item.name}" (HTTP ${res.status}).`)
  }
  const blob = await res.blob()
  return new File([blob], item.name, { type: item.exportAs?.mimeType || item.mimeType })
}

export const googleDriveSource = {
  id: 'gdrive',
  label: 'Google Drive',
  parseFolderId,
  listFolder,
  fetchFile,
}
