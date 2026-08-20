import * as pdfjsLib from 'pdfjs-dist'

// Set the worker source using import.meta.url so Vite emits the file correctly.
// Never use a CDN URL here — the Vite bundler must resolve it at build time.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// ---------------------------------------------------------------------------
// Supported file types
//
// `kind` drives downstream behaviour: chunker.js splits code on line
// boundaries rather than sentence boundaries, since prose heuristics cut
// functions in half.
// ---------------------------------------------------------------------------
export const TYPE_GROUPS = {
  prose: {
    label: 'Documents',
    kind: 'prose',
    extensions: ['.txt', '.md', '.markdown', '.rst', '.adoc', '.asciidoc', '.tex', '.org'],
  },
  richDoc: {
    label: 'Rich documents',
    kind: 'prose',
    extensions: ['.pdf', '.docx', '.epub', '.pptx'],
  },
  markup: {
    label: 'Markup',
    kind: 'prose',
    extensions: ['.html', '.htm', '.xhtml', '.xml'],
  },
  tabular: {
    label: 'Tabular',
    kind: 'data',
    extensions: ['.csv', '.tsv'],
  },
  code: {
    label: 'Code',
    kind: 'code',
    extensions: [
      '.py', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.java', '.go', '.rs',
      '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.rb', '.php', '.swift', '.kt',
      '.scala', '.r', '.lua', '.pl', '.dart', '.ex', '.exs', '.clj', '.hs',
    ],
  },
  config: {
    label: 'Config & data',
    kind: 'code',
    extensions: [
      '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.conf', '.properties', '.sql', '.graphql', '.gql', '.proto',
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.dockerfile', '.log',
    ],
  },
}

/** Flat extension → kind lookup. */
const EXTENSION_KIND = Object.values(TYPE_GROUPS).reduce((acc, group) => {
  for (const ext of group.extensions) acc[ext] = group.kind
  return acc
}, {})

export const SUPPORTED_TYPES = Object.keys(EXTENSION_KIND)

/** Extensions needing a dedicated parser; everything else is read as text. */
const BINARY_OR_STRUCTURED = new Set([
  '.pdf', '.docx', '.epub', '.pptx',
  '.html', '.htm', '.xhtml', '.xml',
  '.csv', '.tsv',
])

/** Short list for the upload hint — the full list is long. */
export const HINT_TYPES = '.pdf · .docx · .epub · .html · .csv · .md · code & text'

function getExtension(filename) {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i).toLowerCase()
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Guard against a parser that "succeeds" but yields nothing usable.
 *
 * The common case is a scanned PDF: it has no text layer, so extraction
 * returns near-empty text, the document is accepted, and generation then fails
 * in confusing ways much later. Failing here with a specific message is far
 * more actionable.
 */
const MIN_USEFUL_CHARS = 25

function assertExtracted(text, file, hint) {
  const trimmed = (text || '').trim()
  if (trimmed.length >= MIN_USEFUL_CHARS) return trimmed
  throw new Error(
    `No readable text found in "${file.name}". ${hint}`
  )
}

// ── Plain text ─────────────────────────────────────────────────────────────

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })
}

// ── PDF ────────────────────────────────────────────────────────────────────

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

  return assertExtracted(
    pageTexts.join('\n\n'),
    file,
    `The ${pdf.numPages} page(s) contain no text layer — this is usually a scanned document. ` +
      `Run it through OCR (e.g. Adobe, Acrobat, or ocrmypdf) and upload the searchable version.`
  )
}

// ── DOCX ───────────────────────────────────────────────────────────────────

async function readDocxFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  let mammoth
  try {
    mammoth = (await import('mammoth')).default
  } catch {
    throw new Error('mammoth library not available')
  }
  const result = await mammoth.extractRawText({ arrayBuffer })
  return assertExtracted(result.value, file, 'The document appears to be empty.')
}

// ── HTML / XML — no dependency, DOMParser is built into the browser ────────

/** Elements that never carry document content. */
const HTML_NOISE = 'script, style, noscript, nav, header, footer, aside, iframe, svg, form, button'

async function readHtmlFile(file) {
  const raw = await readTextFile(file)
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  doc.querySelectorAll(HTML_NOISE).forEach((el) => el.remove())

  // Prefer the semantic content root when the page has one
  const root =
    doc.querySelector('article') ||
    doc.querySelector('main') ||
    doc.querySelector('[role="main"]') ||
    doc.body

  if (!root) throw new Error(`Could not parse "${file.name}" as HTML.`)

  // innerText is not implemented in the detached document, so normalise
  // textContent whitespace manually while keeping block-level breaks.
  root.querySelectorAll('p, div, section, li, tr, h1, h2, h3, h4, h5, h6, br').forEach((el) => {
    el.append('\n')
  })

  const text = (root.textContent || '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')

  return assertExtracted(text, file, 'The page has no readable body content.')
}

async function readXmlFile(file) {
  const raw = await readTextFile(file)
  const doc = new DOMParser().parseFromString(raw, 'application/xml')

  if (doc.querySelector('parsererror')) {
    throw new Error(`"${file.name}" is not well-formed XML.`)
  }

  const text = (doc.documentElement?.textContent || '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return assertExtracted(text, file, 'The XML contains no text nodes.')
}

// ── CSV / TSV ──────────────────────────────────────────────────────────────

/**
 * RFC 4180-style parser: handles quoted fields containing the delimiter,
 * newlines, and escaped quotes ("").
 */
export function parseDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') { inQuotes = true; continue }
    if (ch === delimiter) { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }

  // Flush trailing field/row (file may not end with a newline)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Does the first row look like a header?
 * Headers are typically all non-empty and non-numeric.
 */
function looksLikeHeader(rows) {
  if (rows.length < 2) return false
  const first = rows[0]
  return first.every((c) => c.trim() !== '' && !/^-?\d+(\.\d+)?$/.test(c.trim()))
}

/**
 * Render tabular data as labelled records rather than raw delimited text.
 *
 * Dumping a CSV verbatim gives the model comma-soup with no idea which value
 * belongs to which column. Emitting "Header: value" lines preserves the
 * semantics the LLM needs to write meaningful questions.
 */
async function readDelimitedFile(file, delimiter) {
  const raw = await readTextFile(file)
  const rows = parseDelimited(raw, delimiter)

  if (!rows.length) {
    throw new Error(`No rows found in "${file.name}".`)
  }

  const hasHeader = looksLikeHeader(rows)
  const headers = hasHeader
    ? rows[0].map((h) => h.trim())
    : rows[0].map((_, i) => `Column ${i + 1}`)
  const dataRows = hasHeader ? rows.slice(1) : rows

  if (!dataRows.length) {
    throw new Error(`"${file.name}" has a header row but no data rows.`)
  }

  const records = dataRows.map((row, rowIdx) => {
    const lines = [`Record ${rowIdx + 1}`]
    row.forEach((cell, i) => {
      const value = cell.trim()
      if (!value) return                       // skip empty cells
      lines.push(`${headers[i] ?? `Column ${i + 1}`}: ${value}`)
    })
    return lines.join('\n')
  })

  return assertExtracted(records.join('\n\n'), file, 'All rows were empty.')
}

// ── ZIP-backed formats (EPUB, PPTX) ────────────────────────────────────────

async function loadZip(file) {
  let JSZip
  try {
    JSZip = (await import('jszip')).default
  } catch {
    throw new Error('jszip library not available')
  }
  try {
    return await JSZip.loadAsync(await file.arrayBuffer())
  } catch (err) {
    throw new Error(`"${file.name}" is not a valid archive: ${err.message}`)
  }
}

/** Strip markup from an XHTML string using DOMParser. */
function xhtmlToText(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/html')
  doc.querySelectorAll(HTML_NOISE).forEach((el) => el.remove())
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br').forEach((el) => el.append('\n'))
  return (doc.body?.textContent || '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim()
}

/**
 * EPUB — a ZIP of XHTML. Follows container.xml → OPF → spine so chapters come
 * out in reading order; falls back to sorted filenames if that chain breaks.
 */
async function readEpubFile(file) {
  const zip = await loadZip(file)
  const parser = new DOMParser()
  let hrefs = []

  try {
    const containerXml = await zip.file('META-INF/container.xml')?.async('string')
    const opfPath = containerXml
      ? parser
          .parseFromString(containerXml, 'application/xml')
          .querySelector('rootfile')
          ?.getAttribute('full-path')
      : null

    if (opfPath) {
      const opfXml = await zip.file(opfPath)?.async('string')
      if (opfXml) {
        const opf = parser.parseFromString(opfXml, 'application/xml')
        const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

        // manifest id -> href
        const manifest = {}
        opf.querySelectorAll('manifest > item').forEach((item) => {
          manifest[item.getAttribute('id')] = item.getAttribute('href')
        })

        // spine gives reading order
        hrefs = [...opf.querySelectorAll('spine > itemref')]
          .map((ref) => manifest[ref.getAttribute('idref')])
          .filter(Boolean)
          .map((href) => decodeURIComponent(baseDir + href))
      }
    }
  } catch {
    // Malformed metadata — fall through to the filename scan below
  }

  if (!hrefs.length) {
    hrefs = Object.keys(zip.files)
      .filter((n) => /\.x?html?$/i.test(n))
      .sort()
  }

  const parts = []
  for (const href of hrefs) {
    const entry = zip.file(href)
    if (!entry) continue
    const text = xhtmlToText(await entry.async('string'))
    if (text) parts.push(text)
  }

  return assertExtracted(
    parts.join('\n\n'),
    file,
    'The EPUB contains no readable chapters — it may be DRM-protected.'
  )
}

/**
 * PPTX — text lives in <a:t> nodes inside ppt/slides/slideN.xml.
 * Slides are numbered, so sort numerically rather than lexically
 * (otherwise slide10 sorts before slide2).
 */
async function readPptxFile(file) {
  const zip = await loadZip(file)

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const num = (s) => parseInt(s.match(/slide(\d+)\.xml$/)[1], 10)
      return num(a) - num(b)
    })

  const parser = new DOMParser()
  const parts = []

  for (const name of slideNames) {
    const xml = await zip.file(name)?.async('string')
    if (!xml) continue
    const doc = parser.parseFromString(xml, 'application/xml')
    // getElementsByTagName matches regardless of the a: namespace prefix
    const runs = [...doc.getElementsByTagName('a:t')].map((n) => n.textContent.trim())
    const body = runs.filter(Boolean).join('\n')
    if (body) {
      const slideNo = name.match(/slide(\d+)\.xml$/)[1]
      parts.push(`Slide ${slideNo}\n${body}`)
    }
  }

  return assertExtracted(
    parts.join('\n\n'),
    file,
    'No text found on any slide — the deck may contain only images.'
  )
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Read a File and return { name, text, kind, size, sizeFormatted, charCount }.
 * Throws a descriptive Error on failure for the caller to surface as a toast.
 */
export async function readFile(file) {
  const ext = getExtension(file.name)

  // Extensionless well-known filenames (Dockerfile, Makefile, …) read as text
  const isKnownExtensionless = /^(dockerfile|makefile|rakefile|gemfile|procfile)$/i.test(file.name)

  if (!EXTENSION_KIND[ext] && !isKnownExtensionless) {
    throw new Error(
      `Unsupported file type "${ext || file.name}". ` +
        `Supported: documents (.pdf, .docx, .epub, .pptx), markup (.html, .xml), ` +
        `tabular (.csv, .tsv), and any plain-text or code file.`
    )
  }

  let text
  if (!BINARY_OR_STRUCTURED.has(ext)) {
    // Everything text-based — prose, code, config, logs — needs no parser
    text = await readTextFile(file)
    text = assertExtracted(text, file, 'The file is empty.')
  } else if (ext === '.pdf') {
    text = await readPdfFile(file)
  } else if (ext === '.docx') {
    text = await readDocxFile(file)
  } else if (ext === '.epub') {
    text = await readEpubFile(file)
  } else if (ext === '.pptx') {
    text = await readPptxFile(file)
  } else if (ext === '.csv') {
    text = await readDelimitedFile(file, ',')
  } else if (ext === '.tsv') {
    text = await readDelimitedFile(file, '\t')
  } else if (ext === '.xml') {
    text = await readXmlFile(file)
  } else {
    // .html, .htm, .xhtml
    text = await readHtmlFile(file)
  }

  return {
    name: file.name,
    text,
    kind: EXTENSION_KIND[ext] || 'code',
    size: file.size,
    sizeFormatted: formatSize(file.size),
    charCount: text.length,
  }
}

/**
 * Wrap pasted raw text into the same shape as a file-loaded document.
 */
export function readPastedText(text, label) {
  const size = new Blob([text]).size
  return {
    name: label || 'Pasted text',
    text,
    kind: 'prose',
    size,
    sizeFormatted: formatSize(size),
    charCount: text.length,
  }
}
