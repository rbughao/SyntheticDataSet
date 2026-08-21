import { partition } from './exclusions.js'

/**
 * Local folder source.
 *
 * `<input type="file" webkitdirectory>` hands back every file in every
 * subfolder as an ordinary File, each carrying a `webkitRelativePath`. That
 * means no backend, no CORS, no permission ceremony — and the File objects
 * feed the existing readFile() unchanged.
 */

/** Normalize a FileList from a directory input into candidate items. */
export function fromFileList(fileList) {
  const items = Array.from(fileList).map((file) => ({
    // webkitRelativePath keeps two README.md files distinguishable
    path: file.webkitRelativePath || file.name,
    name: file.name,
    size: file.size,
    file,
  }))
  return partition(items)
}

/**
 * Walk a dropped directory using the webkitGetAsEntry API.
 *
 * Dropping a folder is the obvious gesture, but DataTransfer exposes folders
 * only through this older entry API — plain `dataTransfer.files` yields
 * nothing useful for a directory.
 *
 * @param {DataTransferItemList} itemList
 * @returns {Promise<Array>} candidate items (unpartitioned)
 */
export async function fromDataTransfer(itemList) {
  const entries = []
  for (const item of itemList) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  const out = []

  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      out.push({
        path: prefix + entry.name,
        name: entry.name,
        size: file.size,
        file,
      })
      return
    }
    if (entry.isDirectory) {
      const reader = entry.createReader()
      // readEntries returns at most ~100 per call, so it must be drained
      let batch
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        for (const child of batch) {
          await walk(child, `${prefix}${entry.name}/`)
        }
      } while (batch.length > 0)
    }
  }

  for (const entry of entries) await walk(entry, '')
  return out
}

/** True when a drag event carries at least one directory. */
export function dragHasDirectory(dataTransfer) {
  return Array.from(dataTransfer?.items || []).some((i) => {
    const entry = i.webkitGetAsEntry?.()
    return entry?.isDirectory
  })
}

export const folderSource = {
  id: 'folder',
  label: 'Folder',
  fromFileList,
  fromDataTransfer,
  /** Items already carry their File, so fetch is a passthrough. */
  fetch: async (item) => item.file,
}
