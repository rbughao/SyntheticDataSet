/**
 * Drop-in replacement for fetch() that routes through the Vite dev-server
 * CORS proxy when running in development mode (import.meta.env.DEV === true).
 *
 * How it works (dev mode):
 *   - The full target URL is placed in an `x-proxy-target` header.
 *   - The browser makes a same-origin request to /api/cors-proxy.
 *   - The Vite middleware (vite.config.js) reads the header and forwards the
 *     request server-side using Node's native fetch — no CORS restriction.
 *   - The response is piped back with Access-Control-Allow-Origin: * added.
 *
 * In production builds (DEV === false) this simply calls fetch() directly.
 * Production users must configure CORS headers on their own servers.
 */
export async function proxyFetch(url, init = {}) {
  if (!import.meta.env.DEV) {
    return fetch(url, init)
  }

  // Clone or create a new Headers object so we don't mutate the caller's headers
  const headers = new Headers(init.headers || {})
  // The full target URL goes in the header; the proxy endpoint is a fixed path
  headers.set('x-proxy-target', url)

  return fetch('/api/cors-proxy', { ...init, headers })
}
