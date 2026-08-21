import { proxyFetch } from '../utils/corsProxy.js'

/**
 * Web URL source.
 *
 * Fetches a page through the existing dev CORS proxy and turns the response
 * into a File, so readFile() handles the parsing — HTML extraction, PDF text,
 * CSV rows, and so on all come for free.
 *
 * In production builds proxyFetch falls back to a direct fetch, which most
 * origins will refuse on CORS grounds. That limitation is surfaced to the
 * user rather than hidden.
 */

/** Content types we know how to parse, mapped to the extension readFile expects. */
const TYPE_TO_EXT = [
  ['text/html', '.html'],
  ['application/xhtml', '.html'],
  ['application/pdf', '.pdf'],
  ['text/markdown', '.md'],
  ['text/csv', '.csv'],
  ['text/tab-separated-values', '.tsv'],
  ['application/json', '.json'],
  ['application/xml', '.xml'],
  ['text/xml', '.xml'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/epub+zip', '.epub'],
  ['text/plain', '.txt'],
]

function extForContentType(contentType) {
  const ct = (contentType || '').toLowerCase()
  for (const [needle, ext] of TYPE_TO_EXT) {
    if (ct.includes(needle)) return ext
  }
  return null
}

/**
 * Add a scheme when the user omits it, which they usually do — and reject
 * anything that is not really a web address.
 *
 * The scheme has to be detected before defaulting, not after: blindly
 * prefixing "https://" turns "ftp://x.com" into "https://ftp://x.com", which
 * the URL parser happily mangles into "https://ftp//x.com" rather than
 * failing. Whitespace gets the same treatment — "not a url" would otherwise
 * percent-encode into a plausible-looking hostname.
 */
export function normalizeUrl(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (/\s/.test(trimmed)) return null

  // Requiring "://" is what separates a scheme from a host:port — without it,
  // "localhost:8080/page.html" parses as scheme "localhost:" and gets rejected.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  // Reject ftp://, file:// and friends outright rather than coercing them
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null

  try {
    const u = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // Credentials in the URL are never wanted here, and rejecting them also
    // catches schemeless oddities like "mailto:a@b.com" that would otherwise
    // parse as user:pass@host.
    if (u.username || u.password) return null
    // A bare word is not a host; localhost is the one legitimate exception
    const host = u.hostname
    if (!host) return null
    if (!host.includes('.') && host !== 'localhost') return null
    return u
  } catch {
    return null
  }
}

/**
 * Derive a readable document name from the URL, ending in the extension that
 * matches the response so readFile picks the right parser.
 */
function nameFor(url, ext) {
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1] || url.hostname
  // Strip any existing extension; we append the content-type-derived one
  const stem = last.replace(/\.[a-z0-9]{1,8}$/i, '') || url.hostname
  return `${stem}${ext}`
}

/**
 * Fetch one URL and return a File ready for readFile().
 * Throws with a message suitable for showing directly to the user.
 */
export async function fetchUrlAsFile(rawUrl) {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new Error('Enter a valid http:// or https:// address.')

  let res
  try {
    res = await proxyFetch(url.href, { method: 'GET' })
  } catch (err) {
    throw new Error(
      import.meta.env.DEV
        ? `Could not reach ${url.hostname}: ${err.message}`
        : `Could not reach ${url.hostname}. Production builds have no CORS proxy, ` +
          `so most sites will refuse a direct browser request.`
    )
  }

  if (!res.ok) {
    throw new Error(`${url.hostname} returned HTTP ${res.status}.`)
  }

  const contentType = res.headers.get('content-type') || ''
  const ext = extForContentType(contentType)
  if (!ext) {
    throw new Error(
      `${url.hostname} returned "${contentType.split(';')[0] || 'an unknown type'}", ` +
      `which is not a readable document.`
    )
  }

  const blob = await res.blob()
  return new File([blob], nameFor(url, ext), { type: blob.type || contentType })
}

export const urlSource = {
  id: 'url',
  label: 'URL',
  fetchUrlAsFile,
  normalizeUrl,
}
