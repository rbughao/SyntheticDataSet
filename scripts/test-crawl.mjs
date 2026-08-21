/**
 * Site-crawl tests.
 *
 * Spins up a local fixture site containing the things that actually break
 * crawlers — a cycle, an off-origin link, a robots.txt Disallow, a noindex
 * page, tracking params that disguise one page as many, and a non-HTML file —
 * then drives the real crawler in the browser against it.
 *
 *   npm run dev          # in one terminal
 *   npm run test:crawl   # in another
 */
import puppeteer from 'puppeteer-core'
import http from 'node:http'

const APP = process.env.APP_URL || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; console.log(`  \u2717 ${name}`); if (detail) console.log(`      ${detail}`) }
}

// ── Fixture site ───────────────────────────────────────────────────────────
const page = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

const ROUTES = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },

  '/': { type: 'text/html', body: page('Home', `
    <nav><a href="/">Home</a></nav>
    <h1>Handbook</h1>
    <p>The onboarding handbook explains how the deployment pipeline is structured.</p>
    <a href="/alpha">Alpha</a>
    <a href="/beta?utm_source=newsletter">Beta with tracking</a>
    <a href="/beta">Beta plain</a>
    <a href="/private/secret">Private</a>
    <a href="/hidden">Hidden</a>
    <a href="/data.csv">Data</a>
    <a href="/image.png">Image</a>
    <a href="https://example.com/external">External</a>
    <a href="mailto:someone@example.com">Mail</a>
  `) },

  // Cycles back to home — the crawler must not loop
  '/alpha': { type: 'text/html', body: page('Alpha', `
    <h1>Alpha</h1><p>Alpha describes the rollout procedure for the staging cluster.</p>
    <a href="/">Back home</a><a href="/gamma">Gamma</a>
  `) },

  '/beta': { type: 'text/html', body: page('Beta', `
    <h1>Beta</h1><p>Beta covers the rollback procedure when a deploy fails validation.</p>
  `) },

  // Depth 2 — only reachable via /alpha
  '/gamma': { type: 'text/html', body: page('Gamma', `
    <h1>Gamma</h1><p>Gamma documents the alerting thresholds used by the on-call rota.</p>
  `) },

  '/private/secret': { type: 'text/html', body: page('Private', '<p>Should never be fetched.</p>') },

  '/hidden': { type: 'text/html', body:
    `<!doctype html><html><head><meta name="robots" content="noindex"></head>
     <body><p>This page asked not to be indexed at all.</p></body></html>` },

  '/data.csv': { type: 'text/csv', body: 'metric,value\n"deploy time","4m"\n"rollback time","90s"\n' },
  '/image.png': { type: 'image/png', body: 'not-really-a-png' },
}

function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = req.url.split('?')[0]
      const route = ROUTES[path]
      if (!route) { res.statusCode = 404; res.end('not found'); return }
      res.setHeader('Content-Type', route.type)
      res.end(route.body)
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ── Unit-level: URL normalization and robots parsing ───────────────────────
async function testHelpers(p) {
  console.log('\nURL dedupe + robots parsing')
  const r = await p.evaluate(async () => {
    const m = await import('/src/sources/crawler.js')
    const k = (u) => m.dedupeKey(new URL(u))
    const rules = m.parseRobots(
      '# comment\nUser-agent: badbot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/ok\n'
    )
    return {
      stripsHash: k('https://a.com/x#frag') === k('https://a.com/x'),
      stripsTracking: k('https://a.com/x?utm_source=n&id=2') === k('https://a.com/x?id=2'),
      sortsParams: k('https://a.com/x?b=2&a=1') === k('https://a.com/x?a=1&b=2'),
      trailingSlash: k('https://a.com/docs/') === k('https://a.com/docs'),
      keepsRealParams: k('https://a.com/x?id=1') !== k('https://a.com/x?id=2'),
      caseHost: k('https://A.COM/x') === k('https://a.com/x'),
      ruleCount: rules.length,
      blocksPrivate: m.isAllowedByRobots('/private/thing', rules) === false,
      allowsOverride: m.isAllowedByRobots('/private/ok', rules) === true,
      allowsOther: m.isAllowedByRobots('/public', rules) === true,
      ignoresOtherAgent: m.isAllowedByRobots('/anything', rules) === true,
    }
  })
  check('strips #fragment', r.stripsHash)
  check('strips tracking params', r.stripsTracking)
  check('sorts query params', r.sortsParams)
  check('treats /docs and /docs/ as one', r.trailingSlash)
  check('keeps meaningful params distinct', r.keepsRealParams)
  check('lowercases the host', r.caseHost)
  check('parses only the User-agent:* group', r.ruleCount === 2, `got ${r.ruleCount} rules`)
  check('honours Disallow', r.blocksPrivate)
  check('longer Allow overrides Disallow', r.allowsOverride)
  check('unlisted paths allowed', r.allowsOther)
  check('other agents\u2019 rules ignored', r.ignoresOtherAgent)
}

// ── End to end against the fixture site ────────────────────────────────────
async function testCrawl(p, base) {
  console.log('\nCrawl (end to end)')
  const res = await p.evaluate(async (origin) => {
    const m = await import('/src/sources/crawler.js')
    const out = await m.crawlSite(origin, { maxDepth: 1, maxPages: 25, delayMs: 0 }, {})
    return {
      urls: out.pages.map((x) => x.url),
      names: out.pages.map((x) => x.file.name),
      skipped: out.skipped.map((s) => ({ url: s.url, reason: s.reason })),
    }
  }, base)

  const paths = res.urls.map((u) => new URL(u).pathname)
  const skipReason = (needle) =>
    res.skipped.find((s) => s.url.includes(needle))?.reason ?? null

  check('fetches the start page', paths.includes('/'))
  check('follows same-origin links', paths.includes('/alpha') && paths.includes('/beta'))
  check('terminates on a cycle', paths.filter((x) => x === '/').length === 1,
    `"/" fetched ${paths.filter((x) => x === '/').length}\u00d7`)
  check('collapses tracking-param duplicates', paths.filter((x) => x === '/beta').length === 1,
    `/beta fetched ${paths.filter((x) => x === '/beta').length}\u00d7`)
  check('does not follow off-origin links', !res.urls.some((u) => u.includes('example.com')))
  check('does not follow mailto:', !res.urls.some((u) => u.startsWith('mailto')))
  check('respects robots.txt Disallow', skipReason('/private') === 'robots',
    `reason=${skipReason('/private')}`)
  check('respects meta noindex', skipReason('/hidden') === 'noindex',
    `reason=${skipReason('/hidden')}`)
  check('imports linked non-HTML documents', paths.includes('/data.csv'))
  check('skips unreadable content types', skipReason('/image.png') === 'unsupported',
    `reason=${skipReason('/image.png')}`)
  check('stops at maxDepth', !paths.includes('/gamma'),
    'gamma is depth 2 and should not appear at maxDepth 1')
  check('names files from the URL', res.names.every((n) => /^\d\d-.+\.(html|csv)$/.test(n)),
    JSON.stringify(res.names))

  // depth 2 reaches gamma
  const deep = await p.evaluate(async (origin) => {
    const m = await import('/src/sources/crawler.js')
    const out = await m.crawlSite(origin, { maxDepth: 2, maxPages: 25, delayMs: 0 }, {})
    return out.pages.map((x) => new URL(x.url).pathname)
  }, base)
  check('depth 2 reaches second-level links', deep.includes('/gamma'), JSON.stringify(deep))

  // page cap is a hard stop
  const capped = await p.evaluate(async (origin) => {
    const m = await import('/src/sources/crawler.js')
    const out = await m.crawlSite(origin, { maxDepth: 2, maxPages: 2, delayMs: 0 }, {})
    return out.pages.length
  }, base)
  check('honours maxPages', capped === 2, `fetched ${capped}`)

  // cancellation stops the crawl
  const cancelled = await p.evaluate(async (origin) => {
    const m = await import('/src/sources/crawler.js')
    const cancelRef = { current: false }
    const p2 = m.crawlSite(origin, { maxDepth: 2, maxPages: 25, delayMs: 60 }, { cancelRef })
    setTimeout(() => { cancelRef.current = true }, 80)
    const out = await p2
    return out.pages.length
  }, base)
  check('cancellation stops early', cancelled < 5, `fetched ${cancelled}`)
}

// ── UI wiring ──────────────────────────────────────────────────────────────
async function testUi(p, base) {
  console.log('\nCrawl through the UI')
  await p.evaluate(async () => {
    localStorage.clear()
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase('synthgen')
      q.onsuccess = q.onerror = q.onblocked = () => r()
    })
  })
  await p.goto(APP, { waitUntil: 'networkidle0' })
  await sleep(400)

  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().toUpperCase() === 'URL')
    if (b) b.click()
  })
  await sleep(250)

  // Toggle crawl on, then submit
  await p.evaluate(() => {
    const cb = [...document.querySelectorAll('input[type=checkbox]')]
      .find((c) => c.closest('label')?.textContent.includes('follow links'))
    if (cb) { cb.click() }
  })
  await sleep(250)
  const controlsShown = await p.evaluate(() => /Depth|Max pages/.test(document.body.innerText))
  check('crawl controls appear when enabled', controlsShown)

  await p.$eval('input[inputmode="url"]', (el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, base)
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Crawl Site/.test(x.textContent))
    if (b) b.click()
  })

  await p.waitForFunction(() => /Review crawled pages/.test(document.body.innerText), { timeout: 25000 })
    .catch(() => {})
  await sleep(500)

  const modal = await p.evaluate(() => {
    const t = document.body.innerText
    const m = t.match(/(\d+) usable . (\d+) excluded . (\d+) selected/)
    return {
      open: /Review crawled pages/.test(t),
      usable: m ? +m[1] : null,
      excluded: m ? +m[2] : null,
      estimate: /If you generate from this selection/i.test(t),
    }
  })
  check('crawl results open the review gate', modal.open)
  check('review lists crawled pages', modal.usable >= 3, `usable=${modal.usable}`)
  check('review lists skipped pages', modal.excluded >= 2, `excluded=${modal.excluded}`)
  check('cost estimate shown for the crawl', modal.estimate)

  // Excluded detail should use crawl vocabulary, not filesystem vocabulary
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /excluded —/.test(x.textContent))
    if (b) b.click()
  })
  await sleep(350)
  const vocab = await p.evaluate(() => /Blocked by robots\.txt|Marked noindex/.test(document.body.innerText))
  check('uses crawl-specific skip reasons', vocab)

  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Import \d/.test(x.textContent.trim()))
    if (b) b.click()
  })
  await p.waitForFunction(() => /chars/.test(document.body.innerText), { timeout: 20000 }).catch(() => {})
  await sleep(900)
  const imported = await p.evaluate(() =>
    [...document.querySelectorAll('p.truncate')].map((n) => n.textContent))
  check('pages imported as documents', imported.length >= 3, JSON.stringify(imported))
}

async function main() {
  const { server, port } = await startFixtureServer()
  const base = `http://127.0.0.1:${port}/`
  console.log('Fixture site on', base)

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const p = await browser.newPage()
  await p.setViewport({ width: 1440, height: 950 })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  await p.goto(APP, { waitUntil: 'networkidle0' })

  await testHelpers(p)
  await testCrawl(p, base)
  await testUi(p, base)

  console.log('\nPage errors:', errs.length ? errs : 'none')
  if (errs.length) fail += errs.length

  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
