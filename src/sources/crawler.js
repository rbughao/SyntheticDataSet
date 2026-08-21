import { proxyFetch } from '../utils/corsProxy.js'
import { normalizeUrl } from './urlSource.js'

/**
 * Same-origin site crawler.
 *
 * Following links turns one page into a corpus, but it also means firing a lot
 * of requests at someone else's server. The limits here are deliberate rather
 * than emergent: bounded depth and page count, one request at a time with a
 * delay between them, robots.txt honoured, and off-origin links never followed.
 */

export const CRAWL_DEFAULTS = {
  maxDepth: 1,       // 0 = just the start page
  maxPages: 25,
  delayMs: 400,      // between requests — this is someone else's server
}

export const SKIP = {
  ROBOTS: 'robots',
  NOINDEX: 'noindex',
  UNSUPPORTED: 'unsupported',
  ERROR: 'fetch-error',
}

export const SKIP_LABEL = {
  [SKIP.ROBOTS]: 'Blocked by robots.txt',
  [SKIP.NOINDEX]: 'Marked noindex',
  [SKIP.UNSUPPORTED]: 'Not a readable page',
  [SKIP.ERROR]: 'Fetch failed',
}

// Params that identify a campaign or session rather than a distinct page.
// Leaving them in makes the same page look like many.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'referrer', '_ga', 'yclid', 'spm',
]

/**
 * Canonical key for deduping. Two URLs that fetch the same page must produce
 * the same key, or the crawler revisits pages until it hits the cap.
 */
export function dedupeKey(url) {
  const u = new URL(url.href ?? url)
  u.hash = ''
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p)
  u.searchParams.sort()
  u.hostname = u.hostname.toLowerCase()
  // "/docs" and "/docs/" are the same page far more often than not
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1)
  }
  return u.href
}

/**
 * Minimal robots.txt parser — the `User-agent: *` group only.
 * Longest matching rule wins, and Allow beats Disallow at equal length,
 * which is the behaviour the major crawlers implement.
 */
export function parseRobots(text) {
  const rules = []
  let inStar = false
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const [rawField, ...rest] = line.split(':')
    const field = rawField.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (field === 'user-agent') {
      inStar = value === '*'
      continue
    }
    if (!inStar) continue
    if (field === 'disallow' && value) rules.push({ allow: false, path: value })
    if (field === 'allow' && value) rules.push({ allow: true, path: value })
  }
  return rules
}

export function isAllowedByRobots(pathname, rules) {
  let best = null
  for (const rule of rules) {
    if (pathname.startsWith(rule.path)) {
      if (!best || rule.path.length > best.path.length ||
         (rule.path.length === best.path.length && rule.allow)) {
        best = rule
      }
    }
  }
  return best ? best.allow : true
}

/** Content types we can turn into a document, mapped to a file extension. */
const READABLE = [
  ['text/html', '.html'], ['application/xhtml', '.html'],
  ['application/pdf', '.pdf'], ['text/markdown', '.md'],
  ['text/csv', '.csv'], ['application/json', '.json'],
  ['text/plain', '.txt'],
]
function extFor(contentType) {
  const ct = (contentType || '').toLowerCase()
  for (const [needle, ext] of READABLE) if (ct.includes(needle)) return ext
  return null
}

/** Same-origin links, absolute, deduped, minus non-navigational schemes. */
export function extractLinks(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // <base href> changes what relative links resolve against
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href')
  const base = baseHref ? new URL(baseHref, baseUrl).href : baseUrl

  const meta = doc.querySelector('meta[name="robots" i]')?.getAttribute('content')?.toLowerCase() || ''
  const noindex = meta.includes('noindex')
  const nofollow = meta.includes('nofollow')

  const origin = new URL(baseUrl).origin
  const links = new Map()

  if (!nofollow) {
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#')) continue
      if (a.getAttribute('rel')?.toLowerCase().includes('nofollow')) continue
      let abs
      try { abs = new URL(href, base) } catch { continue }
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue
      if (abs.origin !== origin) continue      // same-origin only
      abs.hash = ''
      links.set(dedupeKey(abs), abs.href)
    }
  }

  return { links: [...links.values()], noindex, nofollow }
}

function nameFor(url, ext, index) {
  const segs = new URL(url).pathname.split('/').filter(Boolean)
  const last = segs[segs.length - 1] || new URL(url).hostname
  const stem = last.replace(/\.[a-z0-9]{1,8}$/i, '') || 'page'
  // Index keeps names unique when several paths end in the same segment
  return `${String(index).padStart(2, '0')}-${stem}${ext}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Crawl from `startUrl`, breadth-first.
 *
 * @param {string} startUrl
 * @param {object} opts   { maxDepth, maxPages, delayMs }
 * @param {object} hooks  { onProgress({fetched,found,queued,current}), cancelRef }
 * @returns {Promise<{ pages: Array<{file, url}>, skipped: Array<{url, reason, detail}> }>}
 */
export async function crawlSite(startUrl, opts = {}, hooks = {}) {
  const { maxDepth, maxPages, delayMs } = { ...CRAWL_DEFAULTS, ...opts }
  const { onProgress, cancelRef } = hooks

  const start = normalizeUrl(startUrl)
  if (!start) throw new Error('Enter a valid http:// or https:// address.')

  // Fetch robots.txt once. A missing or unreadable file means no restrictions.
  let robotRules = []
  try {
    const res = await proxyFetch(`${start.origin}/robots.txt`)
    if (res.ok) robotRules = parseRobots(await res.text())
  } catch {
    // No robots.txt is the common case; proceed unrestricted
  }

  const queue = [{ url: start.href, depth: 0 }]
  const seen = new Set([dedupeKey(start)])
  const pages = []
  const skipped = []

  while (queue.length && pages.length < maxPages) {
    if (cancelRef?.current) break

    const { url, depth } = queue.shift()
    onProgress?.({
      fetched: pages.length,
      skipped: skipped.length,
      queued: queue.length,
      current: url,
    })

    const pathname = new URL(url).pathname
    if (!isAllowedByRobots(pathname, robotRules)) {
      skipped.push({ url, reason: SKIP.ROBOTS })
      continue
    }

    let res
    try {
      res = await proxyFetch(url)
    } catch (err) {
      skipped.push({ url, reason: SKIP.ERROR, detail: err.message })
      continue
    }
    if (!res.ok) {
      skipped.push({ url, reason: SKIP.ERROR, detail: `HTTP ${res.status}` })
      continue
    }

    const contentType = res.headers.get('content-type') || ''
    const ext = extFor(contentType)
    if (!ext) {
      skipped.push({ url, reason: SKIP.UNSUPPORTED, detail: contentType.split(';')[0] })
      continue
    }

    const blob = await res.blob()

    if (ext === '.html') {
      const html = await blob.text()
      const { links, noindex } = extractLinks(html, url)

      if (noindex) {
        // Respect the page's own wishes, but its links are still a valid map
        skipped.push({ url, reason: SKIP.NOINDEX })
      } else {
        pages.push({
          url,
          file: new File([blob], nameFor(url, ext, pages.length + 1), { type: 'text/html' }),
        })
      }

      if (depth < maxDepth) {
        for (const link of links) {
          const key = dedupeKey(link)
          if (seen.has(key)) continue
          seen.add(key)
          queue.push({ url: link, depth: depth + 1 })
        }
      }
    } else {
      // A linked PDF or CSV is worth importing, but is not part of the link graph
      pages.push({
        url,
        file: new File([blob], nameFor(url, ext, pages.length + 1), { type: blob.type }),
      })
    }

    // One request at a time, with a pause — the concurrency pool is tuned for
    // an API you pay for, not for someone else's web server.
    if (queue.length && pages.length < maxPages) await sleep(delayMs)
  }

  onProgress?.({ fetched: pages.length, skipped: skipped.length, queued: 0, current: null })
  return { pages, skipped }
}
