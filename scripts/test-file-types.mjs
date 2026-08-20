/**
 * End-to-end file-type test.
 *
 * Generates a fixture for every supported parser, uploads each through the real
 * file input in headless Chrome, and asserts on what the app actually
 * extracted. This exercises the true code path — DOMParser, jszip, pdf.js —
 * rather than unit-testing the readers in isolation.
 *
 *   npm run dev              # in one terminal
 *   npm run test:filetypes   # in another
 */
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const URL = process.env.APP_URL || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const DIR = path.join(os.tmpdir(), 'synthgen-filetype-fixtures')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Fixtures ───────────────────────────────────────────────────────────────

const PY = `import math


def haversine(lat1, lon1, lat2, lon2):
    """Great-circle distance between two points, in kilometres."""
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


class RoutePlanner:
    """Plans a route across a sequence of waypoints."""

    def __init__(self, waypoints):
        self.waypoints = waypoints

    def total_distance(self):
        return sum(
            haversine(*self.waypoints[i], *self.waypoints[i + 1])
            for i in range(len(self.waypoints) - 1)
        )
`

const HTML = `<!doctype html>
<html><head><title>Ignored</title><style>body{color:red}</style></head>
<body>
  <nav>Home About Contact</nav>
  <script>console.log('should not appear')</script>
  <article>
    <h1>Photosynthesis</h1>
    <p>Photosynthesis converts light energy into chemical energy stored in glucose.</p>
    <p>The light-dependent reactions occur in the thylakoid membrane of the chloroplast.</p>
    <ul><li>Chlorophyll absorbs red and blue wavelengths.</li></ul>
  </article>
  <footer>Copyright notice that should be stripped</footer>
</body></html>`

const CSV = `question,answer,category
"How do I reset my password?","Open Settings, choose Security, then click Reset Password.",Account
"What payment methods are accepted?","We accept Visa, Mastercard, and American Express.",Billing
"Can I export my data?","Yes — use Settings > Export to download a full archive.",Data`

const JSON_FIXTURE = JSON.stringify(
  {
    openapi: '3.0.0',
    info: { title: 'Inventory API', version: '2.1.0' },
    paths: {
      '/items': {
        get: { summary: 'List all inventory items with pagination support.' },
        post: { summary: 'Create a new inventory item from a JSON payload.' },
      },
    },
  },
  null,
  2
)

const XML_FIXTURE = `<?xml version="1.0"?>
<catalog>
  <entry><title>Tidal Locking</title>
    <body>A tidally locked moon always presents the same face to its primary body.</body></entry>
  <entry><title>Orbital Resonance</title>
    <body>Orbital resonance occurs when orbiting bodies exert regular gravitational influence.</body></entry>
</catalog>`

async function makeEpub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title></metadata>
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c2"/><itemref idref="c1"/></spine>
    </package>`
  )
  // The spine deliberately lists ch2 BEFORE ch1, so a correct reader emits
  // "Movable type" before "Gutenberg". A filename sort would get it backwards.
  zip.file(
    'OEBPS/ch1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Chapter One</h1><p>The printing press was developed by Johannes Gutenberg around 1440.</p>
    </body></html>`
  )
  zip.file(
    'OEBPS/ch2.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Chapter Two</h1><p>Movable type dramatically reduced the cost of reproducing books.</p>
    </body></html>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makePptx() {
  const zip = new JSZip()
  const slide = (title, body) =>
    `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
       <p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p>
       <a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
     </p:spTree></p:cSld></p:sld>`

  zip.file('ppt/slides/slide1.xml', slide('Quarterly Review', 'Revenue grew by eighteen percent year over year.'))
  zip.file('ppt/slides/slide2.xml', slide('Regional Split', 'Growth was strongest in the Asia-Pacific region.'))
  // slide10 exists to prove numeric (not lexical) slide ordering
  zip.file('ppt/slides/slide10.xml', slide('Appendix', 'Detailed methodology notes are included here.'))
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ── Test cases ─────────────────────────────────────────────────────────────

const CASES = [
  { file: 'route.py',       expect: [/haversine/, /RoutePlanner/],                  kind: 'code',  desc: 'Python source' },
  { file: 'page.html',      expect: [/Photosynthesis/, /thylakoid/],
    reject: [/console\.log/, /Copyright notice/, /color:red/],                      kind: 'prose', desc: 'HTML (noise stripped)' },
  { file: 'faq.csv',        expect: [/Record 1/, /question: How do I reset/i, /category: Billing/i],
                                                                                    kind: 'data',  desc: 'CSV (row-aware)' },
  { file: 'api.json',       expect: [/Inventory API/, /pagination/],                kind: 'code',  desc: 'JSON / OpenAPI' },
  { file: 'catalog.xml',    expect: [/Tidal Locking/, /Orbital resonance/i],        kind: 'prose', desc: 'XML' },
  // Spine lists ch2 first, so "Movable type" must precede "Gutenberg"
  { file: 'book.epub',      expect: [/Movable type[\s\S]*Gutenberg/],               kind: 'prose', desc: 'EPUB (spine order beats filename sort)' },
  // slide10 must sort after slide2, not lexically between slide1 and slide2
  { file: 'deck.pptx',      expect: [/eighteen percent/, /Asia-Pacific/,
                                     /Slide 1[\s\S]*Slide 2[\s\S]*Slide 10/],       kind: 'prose', desc: 'PPTX (numeric slide order)' },
  { file: 'notes.md',       expect: [/Markdown heading/],                           kind: 'prose', desc: 'Markdown' },
  { file: 'query.sql',      expect: [/SELECT/],                                     kind: 'code',  desc: 'SQL' },
  { file: 'conf.yaml',      expect: [/replicas/],                                   kind: 'code',  desc: 'YAML' },
]

// Files that must be REJECTED with a clear error
const REJECT_CASES = [
  { file: 'empty.txt',   errorMatch: /No readable text|empty/i, desc: 'empty file guard' },
  { file: 'photo.bmp',   errorMatch: /Unsupported file type/i,  desc: 'unsupported type' },
]

async function writeFixtures() {
  await rm(DIR, { recursive: true, force: true })
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, 'route.py'), PY)
  await writeFile(path.join(DIR, 'page.html'), HTML)
  await writeFile(path.join(DIR, 'faq.csv'), CSV)
  await writeFile(path.join(DIR, 'api.json'), JSON_FIXTURE)
  await writeFile(path.join(DIR, 'catalog.xml'), XML_FIXTURE)
  await writeFile(path.join(DIR, 'book.epub'), await makeEpub())
  await writeFile(path.join(DIR, 'deck.pptx'), await makePptx())
  await writeFile(
    path.join(DIR, 'notes.md'),
    '# Markdown heading\n\nSome prose describing the subject in enough detail to pass the minimum length guard.'
  )
  await writeFile(
    path.join(DIR, 'query.sql'),
    'SELECT customer_id, SUM(total) AS lifetime_value\nFROM orders\nGROUP BY customer_id\nHAVING SUM(total) > 1000;'
  )
  await writeFile(
    path.join(DIR, 'conf.yaml'),
    'apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: 3\n  strategy:\n    type: RollingUpdate\n'
  )
  await writeFile(path.join(DIR, 'empty.txt'), '   \n  \n')
  await writeFile(path.join(DIR, 'photo.bmp'), Buffer.from([0x42, 0x4d, 0x00, 0x00]))
}

/** Upload one file and return { text, kind, error } as the app parsed it. */
async function uploadAndRead(page, filename) {
  // Reset app state between cases
  await page.evaluate(() => {
    localStorage.clear()
    return new Promise((res) => {
      const r = indexedDB.deleteDatabase('synthgen')
      r.onsuccess = r.onerror = r.onblocked = () => res()
    })
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(300)

  const input = await page.$('input[type="file"]')
  await input.uploadFile(path.join(DIR, filename))

  // Wait for either a document row or an error toast
  await page.waitForFunction(
    () => /chars/.test(document.body.innerText) || /Unsupported|No readable|Failed|not well-formed|not a valid/i.test(document.body.innerText),
    { timeout: 20000 }
  ).catch(() => {})
  await sleep(600)

  // The preview is truncated to 500 chars — expand it so assertions see the
  // full extracted text. React needs a tick to re-render after the click.
  await page.evaluate(() => {
    const more = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Show more')
    if (more) more.click()
  })
  await sleep(250)

  return page.evaluate(() => {
    const body = document.body.innerText
    const errMatch = body.match(/(Unsupported file type[^\n]*|No readable text[^\n]*|Failed to [^\n]*|[^\n]*not well-formed[^\n]*|[^\n]*not a valid[^\n]*)/)

    // The document preview is a font-mono div, not a <pre>
    const box = document.querySelector('div.font-mono.whitespace-pre-wrap')
    return {
      error: errMatch ? errMatch[0] : null,
      preview: box ? box.textContent : '',
      hasDoc: /chars/.test(body),
    }
  })
}

async function main() {
  await writeFixtures()
  console.log('Fixtures written to', DIR, '\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(URL, { waitUntil: 'networkidle0' })

  let pass = 0
  let fail = 0

  console.log('ACCEPT cases')
  for (const c of CASES) {
    const r = await uploadAndRead(page, c.file)
    const problems = []

    if (r.error) problems.push(`unexpected error: ${r.error}`)
    if (!r.hasDoc) problems.push('document was not added')

    for (const re of c.expect || []) {
      if (!re.test(r.preview)) problems.push(`missing ${re}`)
    }
    for (const re of c.reject || []) {
      if (re.test(r.preview)) problems.push(`should have stripped ${re}`)
    }

    if (problems.length) {
      fail++
      console.log(`  ✗ ${c.file.padEnd(14)} ${c.desc}`)
      problems.forEach((p) => console.log(`      ${p}`))
      console.log(`      preview: ${JSON.stringify(r.preview.slice(0, 160))}`)
    } else {
      pass++
      console.log(`  ✓ ${c.file.padEnd(14)} ${c.desc}`)
    }
  }

  console.log('\nREJECT cases')
  for (const c of REJECT_CASES) {
    const r = await uploadAndRead(page, c.file)
    if (r.error && c.errorMatch.test(r.error)) {
      pass++
      console.log(`  ✓ ${c.file.padEnd(14)} ${c.desc} → "${r.error.slice(0, 70)}"`)
    } else {
      fail++
      console.log(`  ✗ ${c.file.padEnd(14)} ${c.desc}`)
      console.log(`      expected ${c.errorMatch}, got ${r.error ? `"${r.error}"` : 'no error'}`)
    }
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
