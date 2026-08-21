/**
 * Google Drive / OneDrive adapter tests.
 *
 * The live consent flow needs a real client ID and account, so it is not
 * automated. Everything after the token is, by stubbing fetch with a fake
 * Drive and Graph API — which tests this app's logic (recursion, pagination,
 * native-format export, download routing) rather than the providers'.
 *
 *   npm run dev          # in one terminal
 *   npm run test:cloud   # in another
 */
import puppeteer from 'puppeteer-core'

const APP = process.env.APP_URL || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; console.log(`  \u2717 ${name}`); if (detail) console.log(`      ${detail}`) }
}

// Installed in the page: a fake Drive + Graph that records every request.
const INSTALL_MOCK = () => {
  window.__calls = []

  const DRIVE_TREE = {
    // folderId -> pages of children
    root: [
      {
        files: [
          { id: 'f1', name: 'Handbook', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'd1', name: 'Notes', mimeType: 'application/vnd.google-apps.document' },
          { id: 'b1', name: 'report.pdf', mimeType: 'application/pdf', size: '2048' },
        ],
        nextPageToken: 'PAGE2',
      },
      {
        files: [
          { id: 's1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' },
          { id: 'x1', name: 'photo.png', mimeType: 'image/png', size: '900' },
          { id: 'k1', name: '.env', mimeType: 'text/plain', size: '40' },
        ],
      },
    ],
    f1: [{ files: [{ id: 'n1', name: 'deep.md', mimeType: 'text/markdown', size: '512' }] }],
  }

  const GRAPH_TREE = {
    root: [
      {
        value: [
          { id: 'g1', name: 'Docs', folder: { childCount: 1 } },
          { id: 'w1', name: 'spec.docx', size: 4096, file: {}, '@microsoft.graph.downloadUrl': 'https://dl.example/spec.docx' },
        ],
        '@odata.nextLink': 'MORE',
      },
      {
        value: [
          { id: 'k2', name: 'id_rsa', size: 100, file: {} },
        ],
      },
    ],
    g1: [{ value: [{ id: 'r1', name: 'readme.md', size: 300, file: {}, '@microsoft.graph.downloadUrl': 'https://dl.example/readme.md' }] }],
  }

  let drivePage = {}   // folderId -> page index
  let graphPage = {}
  // Each listFolder() call must start from page 1, or the second caller gets
  // the tail of the first call's pagination.
  window.__resetMock = () => { drivePage = {}; graphPage = {}; window.__calls = [] }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    window.__calls.push({ url, headers: Object.fromEntries(new Headers(init.headers || {})) })
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    // ---- Google Drive ----
    if (url.includes('/drive/v3/files?')) {
      const q = new URL(url).searchParams.get('q')
      const folderId = q.match(/'([^']+)' in parents/)[1]
      const pages = DRIVE_TREE[folderId] || [{ files: [] }]
      const i = drivePage[folderId] || 0
      drivePage[folderId] = i + 1
      return json(pages[Math.min(i, pages.length - 1)])
    }
    if (/\/drive\/v3\/files\/[^/?]+\/export/.test(url)) {
      return new Response('exported text', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    if (/\/drive\/v3\/files\/[^/?]+\?/.test(url)) {
      const id = url.match(/\/files\/([^/?]+)/)[1]
      if (url.includes('alt=media')) return new Response('binary', { status: 200 })
      // metadata (getFolderName)
      if (id === 'missing') return json({ error: { message: 'File not found' } }, 404)
      if (id === 'notafolder') return json({ id, name: 'sheet.pdf', mimeType: 'application/pdf' })
      return json({ id, name: 'Handbook Root', mimeType: 'application/vnd.google-apps.folder' })
    }

    // ---- Microsoft Graph ----
    if (url.includes('/shares/')) {
      return json({ id: 'shared1', name: 'Shared Folder', folder: { childCount: 2 } })
    }
    if (url.includes('graph.microsoft.com') && url.includes('/children')) {
      const m = url.match(/items\/([^/]+)\/children/)
      const id = m ? m[1] : 'root'
      const pages = GRAPH_TREE[id] || [{ value: [] }]
      const i = graphPage[id] || 0
      graphPage[id] = i + 1
      return json(pages[Math.min(i, pages.length - 1)])
    }
    if (url === 'MORE') {
      const pages = GRAPH_TREE.root
      const i = graphPage.root || 0
      graphPage.root = i + 1
      return json(pages[Math.min(i, pages.length - 1)])
    }
    if (url.startsWith('https://dl.example/')) {
      return new Response('downloaded bytes', { status: 200 })
    }

    return json({ error: { message: 'unexpected ' + url } }, 500)
  }
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const p = await browser.newPage()
  await p.setViewport({ width: 1440, height: 950 })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  await p.goto(APP, { waitUntil: 'networkidle0' })
  await sleep(400)

  // ── UI ───────────────────────────────────────────────────────────────────
  // Runs first, on a clean page: the mock below replaces window.fetch, which
  // leaves Vite's HMR client retrying forever and the tab never navigable again.
  console.log('\nCloud tab')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().toLowerCase() === 'cloud')
    if (b) b.click()
  })
  await sleep(300)
  const ui = await p.evaluate(() => ({
    tabExists: [...document.querySelectorAll('button')].some((b) => b.textContent.trim().toLowerCase() === 'cloud'),
    emptyState: /No account connected/i.test(document.body.innerText),
    pointsToSettings: /Cloud sources/i.test(document.body.innerText),
  }))
  check('Cloud tab exists', ui.tabExists)
  check('shows an empty state when nothing is connected', ui.emptyState)
  check('points at Settings to connect', ui.pointsToSettings)

  // ── Folder-ID parsing (pure) ─────────────────────────────────────────────
  console.log('\nDrive folder-ID parsing')
  const ids = await p.evaluate(async () => {
    const m = await import('/src/sources/googleDriveSource.js')
    const t = (v) => m.parseFolderId(v)
    return {
      bare: t('1A2b3C4d5E6f7G8h9I0jKlMnOp'),
      folderUrl: t('https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOp'),
      userScoped: t('https://drive.google.com/drive/u/0/folders/1A2b3C4d5E6f7G8h9I0jKlMnOp?usp=sharing'),
      openQuery: t('https://drive.google.com/open?id=1A2b3C4d5E6f7G8h9I0jKlMnOp'),
      notGoogle: t('https://evil.example/drive/folders/1A2b3C4d5E6f7G8h9I0jKlMnOp'),
      garbage: t('hello world'),
      blank: t(''),
    }
  })
  const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOp'
  check('bare ID', ids.bare === ID)
  check('folder URL', ids.folderUrl === ID)
  check('user-scoped URL with query', ids.userScoped === ID)
  check('open?id= URL', ids.openQuery === ID)
  check('rejects a non-Google host', ids.notGoogle === null, ids.notGoogle)
  check('rejects garbage', ids.garbage === null, ids.garbage)
  check('rejects blank', ids.blank === null)

  // ── Drive listing ────────────────────────────────────────────────────────
  console.log('\nDrive listing (mocked API)')
  const drive = await p.evaluate(async (installSrc) => {
    eval('(' + installSrc + ')()')
    sessionStorage.setItem('synthgen_oauth_gdrive', JSON.stringify({ accessToken: 'T', expiresAt: Date.now() + 60000 }))
    const m = await import('/src/sources/googleDriveSource.js')
    const items = await m.listFolder('root', { maxItems: 100 })
    return {
      names: items.map((i) => i.name),
      paths: items.map((i) => i.path),
      exports: items.filter((i) => i.exportAs).map((i) => [i.name, i.exportAs.mimeType]),
      sizes: Object.fromEntries(items.map((i) => [i.name, i.size])),
      authHeaderSent: window.__calls.filter((c) => c.url.includes('drive/v3')).every((c) => c.headers.authorization === 'Bearer T'),
    }
  }, INSTALL_MOCK.toString())

  check('paginates (page 2 items present)', drive.names.includes('Budget.csv'), JSON.stringify(drive.names))
  check('recurses into subfolders', drive.names.includes('deep.md'), JSON.stringify(drive.names))
  check('builds nested paths', drive.paths.some((x) => x === 'Handbook Root/Handbook/deep.md'),
    JSON.stringify(drive.paths))
  check('Docs export as .txt', drive.exports.some(([n, t]) => n === 'Notes.txt' && t === 'text/plain'),
    JSON.stringify(drive.exports))
  check('Sheets export as .csv', drive.exports.some(([n, t]) => n === 'Budget.csv' && t === 'text/csv'),
    JSON.stringify(drive.exports))
  check('native docs get a nominal size', drive.sizes['Notes.txt'] > 0, String(drive.sizes['Notes.txt']))
  check('sends the bearer token', drive.authHeaderSent)

  // ── Exclusions apply to cloud items too ──────────────────────────────────
  console.log('\nExclusions on cloud items')
  const excl = await p.evaluate(async () => {
    const m = await import('/src/sources/googleDriveSource.js')
    const ex = await import('/src/sources/exclusions.js')
    window.__resetMock()
    const items = await m.listFolder('root', { maxItems: 100 })
    const r = ex.partition(items)
    return {
      included: r.included.map((i) => i.name),
      counts: r.counts,
    }
  })
  check('.env excluded from a Drive folder', !excl.included.includes('.env'), JSON.stringify(excl.included))
  check('png excluded as unsupported', !excl.included.includes('photo.png'))
  check('exported Docs survive exclusion', excl.included.includes('Notes.txt'), JSON.stringify(excl.included))
  check('pdf survives exclusion', excl.included.includes('report.pdf'))

  // ── Drive download routing ───────────────────────────────────────────────
  console.log('\nDrive download routing')
  const dl = await p.evaluate(async () => {
    const m = await import('/src/sources/googleDriveSource.js')
    window.__calls = []
    const native = await m.fetchFile({ id: 'd1', name: 'Notes.txt', exportAs: { mimeType: 'text/plain', ext: '.txt' } })
    const binary = await m.fetchFile({ id: 'b1', name: 'report.pdf', mimeType: 'application/pdf', exportAs: null })
    return {
      urls: window.__calls.map((c) => c.url),
      nativeName: native.name,
      nativeText: await native.text(),
      binaryName: binary.name,
    }
  })
  check('native doc uses /export', dl.urls[0].includes('/export?mimeType=text%2Fplain'), dl.urls[0])
  check('binary uses alt=media', dl.urls[1].includes('alt=media'), dl.urls[1])
  check('returns a File with the right name', dl.nativeName === 'Notes.txt' && dl.binaryName === 'report.pdf')
  check('export content preserved', dl.nativeText === 'exported text')

  // ── Drive error paths ────────────────────────────────────────────────────
  console.log('\nDrive error handling')
  const errsOut = await p.evaluate(async () => {
    const m = await import('/src/sources/googleDriveSource.js')
    const grab = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }
    return {
      missing: await grab(() => m.listFolder('missing', {})),
      notFolder: await grab(() => m.listFolder('notafolder', {})),
    }
  })
  check('missing folder gives a clear message', /not found|cannot see/i.test(errsOut.missing || ''), errsOut.missing)
  check('file-instead-of-folder is caught', /is a file, not a folder/i.test(errsOut.notFolder || ''), errsOut.notFolder)

  // ── OneDrive ─────────────────────────────────────────────────────────────
  console.log('\nOneDrive (mocked Graph)')
  const od = await p.evaluate(async () => {
    sessionStorage.setItem('synthgen_oauth_onedrive', JSON.stringify({ accessToken: 'T2', expiresAt: Date.now() + 60000 }))
    window.__resetMock()
    const m = await import('/src/sources/oneDriveSource.js')
    const grab = async (fn) => { try { return { ok: await fn() } } catch (e) { return { err: e.message } } }

    const blank = await m.resolveStart('')
    const bad = await grab(() => m.resolveStart('https://evil.example/x'))
    const notUrl = await grab(() => m.resolveStart('just some text'))
    const shared = await grab(() => m.resolveStart('https://onedrive.live.com/redir?resid=ABC'))

    const items = await m.listFolder({ id: 'root', name: 'My files' }, { maxItems: 100 })

    window.__calls = []
    const file = await m.fetchFile(items.find((i) => i.name === 'spec.docx'))
    const dlCall = window.__calls.find((c) => c.url.startsWith('https://dl.example/'))

    return {
      blankIsRoot: blank.id === 'root',
      rejectsForeignHost: /OneDrive or SharePoint/i.test(bad.err || ''),
      rejectsNonUrl: /folder link/i.test(notUrl.err || ''),
      sharedName: shared.ok?.name ?? shared.err,
      names: items.map((i) => i.name),
      paths: items.map((i) => i.path),
      fileName: file.name,
      downloadHadNoAuthHeader: dlCall ? !dlCall.headers.authorization : false,
    }
  })
  check('blank input means whole drive', od.blankIsRoot)
  check('rejects a foreign host', od.rejectsForeignHost, od.rejectsForeignHost)
  check('rejects non-URL input', od.rejectsNonUrl)
  check('resolves a share link', od.sharedName === 'Shared Folder', String(od.sharedName))
  check('paginates', od.names.includes('id_rsa'), JSON.stringify(od.names))
  check('recurses into subfolders', od.names.includes('readme.md'), JSON.stringify(od.names))
  check('builds nested paths', od.paths.includes('My files/Docs/readme.md'), JSON.stringify(od.paths))
  check('downloads via the pre-signed URL', od.fileName === 'spec.docx')
  check('no bearer token sent to the pre-signed URL', od.downloadHadNoAuthHeader,
    'sending Authorization to a pre-signed URL makes it fail')

  console.log('\nPage errors:', errs.length ? errs : 'none')
  if (errs.length) fail += errs.length
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
