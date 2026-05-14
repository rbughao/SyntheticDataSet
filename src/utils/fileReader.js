import * as pdfjsLib from 'pdfjs-dist'

// Set the worker source using import.meta.url so Vite emits the file correctly.
// Never use a CDN URL here — the Vite bundler must resolve it at build time.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const SUPPORTED_TYPES = ['.txt', '.md', '.pdf', '.docx']

function getExtension(filename) {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase()
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })
}

async function readPdfFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch (err) {
    throw new Error(`Failed to parse PDF "${file.name}": ${err.message}`)
  }

  const pageTexts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => item.str).join(' '))
  }
  return pageTexts.join('\n\n')
}

async function readDocxFile(file) {
  // mammoth expects an ArrayBuffer
  const arrayBuffer = await file.arrayBuffer()
  let mammoth
  try {
    mammoth = (await import('mammoth')).default
  } catch {
    throw new Error('mammoth library not available')
  }
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

/**
 * Read a File object and return { name, text, size, sizeFormatted, charCount }.
 * Throws a descriptive Error on failure for the caller to surface as a toast.
 */
export async function readFile(file) {
  const ext = getExtension(file.name)
  if (!SUPPORTED_TYPES.includes(ext)) {
    throw new Error(
      `Unsupported file type "${ext}". Supported: ${SUPPORTED_TYPES.join(', ')}`
    )
  }

  let text
  if (ext === '.txt' || ext === '.md') {
    text = await readTextFile(file)
  } else if (ext === '.pdf') {
    text = await readPdfFile(file)
  } else if (ext === '.docx') {
    text = await readDocxFile(file)
  }

  return {
    name: file.name,
    text,
    size: file.size,
    sizeFormatted: formatSize(file.size),
    charCount: text.length,
  }
}

/**
 * Wrap pasted raw text into the same shape as a file-loaded document.
 */
export function readPastedText(text, label) {
  return {
    name: label || `Pasted text`,
    text,
    size: new Blob([text]).size,
    sizeFormatted: formatSize(new Blob([text]).size),
    charCount: text.length,
  }
}
