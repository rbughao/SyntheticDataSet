import { authorizedFetch } from './oauth.js'

/**
 * OneDrive listing and download, via Microsoft Graph.
 *
 * Simpler than Drive in one important way: Office files download as real
 * .docx/.xlsx/.pptx, which this app already parses, so nothing needs exporting.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'

/**
 * Encode a sharing link the way Graph's /shares endpoint expects:
 * base64url of the URL, prefixed with "u!".
 */
function encodeShareLink(url) {
  const b64 = btoa(unescape(encodeURIComponent(url)))
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * Resolve what the user typed into a starting item.
 * Blank means the whole drive; otherwise a OneDrive/SharePoint share link.
 *
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function resolveStart(input) {
  const raw = (input || '').trim()
  if (!raw) return { id: 'root', name: 'My files' }

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Paste a OneDrive folder link, or leave the box empty to use your whole drive.')
  }
  if (!/(1drv\.ms|onedrive\.live\.com|sharepoint\.com)$/.test(url.hostname)) {
    throw new Error('That does not look like a OneDrive or SharePoint link.')
  }

  const res = await authorizedFetch('onedrive', `${GRAPH}/shares/${encodeShareLink(url.href)}/driveItem`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Could not open that link (HTTP ${res.status}).`)
  }
  const item = await res.json()
  if (!item.folder) throw new Error(`"${item.name}" is a file, not a folder.`)
  return { id: item.id, name: item.name }
}

async function listChildren(itemId, nextLink) {
  const url =
    nextLink ||
    `${GRAPH}/me/drive/${itemId === 'root' ? 'root' : `items/${itemId}`}/children` +
      `?$select=id,name,size,file,folder,@microsoft.graph.downloadUrl&$top=200`

  const res = await authorizedFetch('onedrive', url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `OneDrive returned HTTP ${res.status}.`)
  }
  return res.json()
}

/**
 * Walk a folder tree breadth-first.
 * @returns {Promise<Array<{ id, name, path, size, downloadUrl }>>}
 */
export async function listFolder(start, { maxItems = 500, onProgress, cancelRef } = {}) {
  const queue = [{ id: start.id, path: start.name }]
  const out = []

  while (queue.length && out.length < maxItems) {
    if (cancelRef?.current) break
    const folder = queue.shift()
    let nextLink

    do {
      if (cancelRef?.current) break
      const page = await listChildren(folder.id, nextLink)

      for (const item of page.value || []) {
        if (item.folder) {
          queue.push({ id: item.id, path: `${folder.path}/${item.name}` })
          continue
        }
        if (out.length >= maxItems) break
        out.push({
          id: item.id,
          name: item.name,
          path: `${folder.path}/${item.name}`,
          size: Number(item.size) || 0,
          // Pre-signed and short-lived; re-fetched at download time if missing
          downloadUrl: item['@microsoft.graph.downloadUrl'] || null,
        })
      }

      onProgress?.({ found: out.length, folders: queue.length, current: folder.path })
      nextLink = page['@odata.nextLink']
    } while (nextLink && out.length < maxItems)
  }

  return out
}

/** Download one item as a File. */
export async function fetchFile(item) {
  let url = item.downloadUrl

  // The pre-signed URL expires; ask Graph for a fresh one if needed
  if (!url) {
    const res = await authorizedFetch(
      'onedrive',
      `${GRAPH}/me/drive/items/${item.id}?$select=@microsoft.graph.downloadUrl`
    )
    if (!res.ok) throw new Error(`Could not download "${item.name}" (HTTP ${res.status}).`)
    url = (await res.json())['@microsoft.graph.downloadUrl']
    if (!url) throw new Error(`No download link for "${item.name}".`)
  }

  // downloadUrl is pre-authorized — sending the bearer token would break it
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download "${item.name}" (HTTP ${res.status}).`)
  const blob = await res.blob()
  return new File([blob], item.name, { type: blob.type })
}

export const oneDriveSource = {
  id: 'onedrive',
  label: 'OneDrive',
  resolveStart,
  listFolder,
  fetchFile,
}
