/**
 * Tests for the bulk ingestion sources (folder + URL).
 *
 * Two layers:
 *   1. Exclusion rules — run against the real module, imported into the page so
 *      pdfjs and the other browser deps resolve. Synthetic paths cover the
 *      directory rules that a file input cannot express.
 *   2. End to end — a folder selection through the real React handler, and a
 *      real URL through the dev proxy.
 *
 *   npm run dev            # in one terminal
 *   npm run test:sources   # in another
 */
import puppeteer from 'puppeteer-core'

const URL_BASE = process.env.APP_URL || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; console.log(`  \u2717 ${name}`); if (detail) console.log(`      ${detail}`) }
}

// ── Layer 1: exclusion rules ───────────────────────────────────────────────
const RULE_CASES = [
  // [path, size, expectExcluded, expectReason]
  ['project/README.md',                 400,  false, null],
  ['project/src/app.py',                900,  false, null],
  ['project/data/rows.csv',             700,  false, null],
  ['project/.env',                       80,  true,  'secret'],
  ['project/.env.production',            80,  true,  'secret'],
  ['project/config/credentials.json',   200,  true,  'secret'],
  ['project/keys/server.pem',           300,  true,  'secret'],
  ['project/deploy/id_ed25519',         300,  true,  'secret'],
  ['project/api_secrets.yaml',          150,  true,  'secret'],
  ['home/.ssh/config',                  120,  true,  'secret'],
  ['home/.aws/anything.txt',            120,  true,  'secret'],
  ['project/node_modules/lib/index.js', 500,  true,  'noise'],
  ['project/.git/COMMIT_EDITMSG',        60,  true,  'noise'],
  ['project/dist/bundle.js',           4000,  true,  'noise'],
  ['project/__pycache__/m.cpython.pyc', 800,  true,  'noise'],
  ['project/logo.png',                 5000,  true,  'unsupported'],
  ['project/empty.md',                    0,  true,  'empty'],
  ['project/huge.txt',           6 * 1024 * 1024, true, 'too-large'],
]

async function testRules(page) {
  console.log('\nExclusion rules')
  const results = await page.evaluate(async (cases) => {
    const mod = await import('/src/sources/exclusions.js')
    return cases.map(([p, size]) => {
      const name = p.split('/').pop()
      const v = mod.classify({ path: p, name, size })
      return { excluded: v.excluded, reason: v.reason || null }
    })
  }, RULE_CASES)

  for (let i = 0; i < RULE_CASES.length; i++) {
    const [p, , wantExcluded, wantReason] = RULE_CASES[i]
    const got = results[i]
    const ok = got.excluded === wantExcluded && (!wantReason || got.reason === wantReason)
    check(
      `${wantExcluded ? 'excludes' : 'keeps  '} ${p}${wantReason ? ` (${wantReason})` : ''}`,
      ok,
      ok ? null : `got excluded=${got.excluded} reason=${got.reason}`
    )
  }

  const tally = await page.evaluate(async () => {
    const mod = await import('/src/sources/exclusions.js')
    return mod.partition([
      { path: 'a/keep.md', name: 'keep.md', size: 100 },
      { path: 'a/.env', name: '.env', size: 50 },
      { path: 'a/b.pem', name: 'b.pem', size: 50 },
      { path: 'a/node_modules/x.js', name: 'x.js', size: 50 },
      { path: 'a/pic.png', name: 'pic.png', size: 50 },
    ]).counts
  })
  check(
    'partition tallies reasons',
    tally.secret === 2 && tally.noise === 1 && tally.unsupported === 1,
    JSON.stringify(tally)
  )
}

// ── Layer 2: folder end to end ─────────────────────────────────────────────
//
// Chrome refuses programmatic file assignment on a webkitdirectory input:
// puppeteer's uploadFile leaves input.files empty and fires no event at all.
// Building a FileList through DataTransfer and dispatching `change` does reach
// the React handler, which is the part worth testing. Synthetic Files carry no
// webkitRelativePath, so the directory rules stay covered by layer 1.
async function testFolder(page) {
  console.log('\nFolder import (end to end)')
  await resetApp(page)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => x.textContent.trim().toLowerCase() === 'folder')
    if (b) b.click()
  })
  await sleep(300)

  const hasInput = await page.$('input[webkitdirectory]')
  check('folder input exists', !!hasInput)
  if (!hasInput) return

  await page.evaluate(() => {
    const el = document.querySelector('input[webkitdirectory]')
    const dt = new DataTransfer()
    const add = (name, body, type) => dt.items.add(new File([body], name, { type }))
    // usable
    add('guide.md', '# Deployment guide\n\nRun the migration before restarting workers.', 'text/markdown')
    add('faq.csv', 'question,answer\n"Roll back?","Run migrate:down."', 'text/csv')
    add('server.py', 'def healthcheck():\n    return {"status": "ok"}\n', 'text/x-python')
    // excluded
    add('.env', 'DATABASE_URL=postgres://user:hunter2@db/prod', 'text/plain')
    add('id_rsa', '-----BEGIN OPENSSH PRIVATE KEY-----', 'text/plain')
    add('server.pem', '-----BEGIN CERTIFICATE-----', 'text/plain')
    add('logo.bmp', 'BM', 'image/bmp')
    add('blank.txt', '', 'text/plain')
    el.files = dt.files
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await page
    .waitForFunction(() => /Review before importing/.test(document.body.innerText), { timeout: 10000 })
    .catch(() => {})
  await sleep(500)

  const modal = await page.evaluate(() => {
    const text = document.body.innerText
    const m = text.match(/(\d+) usable . (\d+) excluded . (\d+) selected/)
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent).join(' ')
    return {
      open: /Review before importing/.test(text),
      usable: m ? +m[1] : null,
      excluded: m ? +m[2] : null,
      selected: m ? +m[3] : null,
      secretWarning: /possible secrets? excluded/i.test(text),
      estimate: /If you generate from this selection/i.test(text),
      listsGuide: /guide\.md/.test(labels),
      secretsSelectable: /\.env|id_rsa|server\.pem/.test(labels),
    }
  })

  check('review modal opens', modal.open)
  check('3 usable / 5 excluded', modal.usable === 3 && modal.excluded === 5,
    `usable=${modal.usable} excluded=${modal.excluded}`)
  check('secrets warning shown', modal.secretWarning)
  check('usable files pre-selected', modal.selected === 3, `selected=${modal.selected}`)
  check('usable files listed', modal.listsGuide)
  check('secrets absent from the selectable list', !modal.secretsSelectable)
  check('cost estimate shown before import', modal.estimate)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /^Import \d/.test(x.textContent.trim()))
    if (b) b.click()
  })
  await page
    .waitForFunction(() => /chars/.test(document.body.innerText), { timeout: 15000 })
    .catch(() => {})
  await sleep(900)

  // Scope this to the document list: the Folder tab's own help text mentions
  // ".env", so testing the whole page body gives a false positive.
  const after = await page.evaluate(() => {
    const t = document.body.innerText
    const names = [...document.querySelectorAll('p.truncate')].map((n) => n.textContent)
    return {
      modalClosed: !/Review before importing/.test(t),
      docNames: names,
    }
  })
  check('modal closes after import', after.modalClosed)
  check('documents imported', after.docNames.some((n) => /guide\.md/.test(n)),
    JSON.stringify(after.docNames))
  check('no secret imported',
    !after.docNames.some((n) => /\.env|id_rsa|\.pem/.test(n)),
    JSON.stringify(after.docNames))
}

// ── Layer 3: URL end to end ────────────────────────────────────────────────
async function testUrl(page) {
  console.log('\nURL import (end to end, through the dev proxy)')
  await resetApp(page)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => x.textContent.trim().toUpperCase() === 'URL')
    if (b) b.click()
  })
  await sleep(300)

  const field = await page.$('input[inputmode="url"]')
  check('url field exists', !!field)
  if (!field) return

  await page.$eval('input[inputmode="url"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, 'example.com')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Fetch Page/.test(x.textContent))
    if (b) b.click()
  })
  await page
    .waitForFunction(() => /chars/.test(document.body.innerText), { timeout: 20000 })
    .catch(() => {})
  await sleep(800)

  const res = await page.evaluate(() => {
    const t = document.body.innerText
    return {
      added: /chars/.test(t),
      name: (t.match(/([\w.-]+\.html)/) || [])[1] ?? null,
      extracted: /Example Domain|documentation examples/i.test(t),
      error: (t.match(/Could not reach[^\n]*|returned HTTP[^\n]*/) || [])[0] ?? null,
    }
  })
  check('page imported as a document', res.added, res.error || 'no document row')
  check('named from the URL with .html', !!res.name, `name=${res.name}`)
  check('readable text extracted', res.extracted)

  // Malformed input must be rejected up front rather than coerced into a
  // plausible-looking request. normalizeUrl is the unit under test here.
  const parsed = await page.evaluate(async () => {
    const m = await import('/src/sources/urlSource.js')
    const t = (v) => m.normalizeUrl(v)?.href ?? null
    return {
      spaces: t('not a url at all'),
      ftp: t('ftp://x.com'),
      file: t('file:///etc/passwd'),
      js: t('javascript:alert(1)'),
      bareWord: t('hello'),
      blank: t('   '),
      plain: t('example.com'),
      withPath: t('https://example.com/docs/a?b=1'),
      localhost: t('localhost:8080/page.html'),
      hostPort: t('example.com:8443/x'),
      creds: t('mailto:someone@example.com'),
    }
  })
  check('rejects whitespace input', parsed.spaces === null, parsed.spaces)
  check('rejects ftp:// instead of coercing', parsed.ftp === null, parsed.ftp)
  check('rejects file://', parsed.file === null, parsed.file)
  check('rejects javascript:', parsed.js === null, parsed.js)
  check('rejects a bare word', parsed.bareWord === null, parsed.bareWord)
  check('rejects blank', parsed.blank === null, parsed.blank)
  check('accepts a bare domain', parsed.plain === 'https://example.com/', parsed.plain)
  check('preserves path and query', parsed.withPath === 'https://example.com/docs/a?b=1', parsed.withPath)
  check('allows localhost with a port', parsed.localhost === 'https://localhost:8080/page.html', parsed.localhost)
  check('treats host:port as a host, not a scheme', parsed.hostPort === 'https://example.com:8443/x', parsed.hostPort)
  check('rejects credentials in the URL', parsed.creds === null, parsed.creds)

  // …and the UI surfaces that rejection rather than failing silently
  await page.$eval('input[inputmode="url"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, 'not a url at all')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Fetch Page/.test(x.textContent))
    if (b) b.click()
  })
  await sleep(700)
  const shown = await page.evaluate(() => /Enter a valid http/i.test(document.body.innerText))
  check('invalid URL shows an error in the UI', shown)
}

async function resetApp(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase('synthgen')
      q.onsuccess = q.onerror = q.onblocked = () => r()
    })
  })
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' })
  await sleep(400)
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 950 })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)))
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' })

  await testRules(page)
  await testFolder(page)
  await testUrl(page)

  console.log('\nPage errors:', pageErrors.length ? pageErrors : 'none')
  if (pageErrors.length) fail += pageErrors.length

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
