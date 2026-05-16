import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

/**
 * Vite plugin: server-side CORS proxy.
 *
 * Intercepts requests to /api/cors-proxy from the browser.
 * Reads the full target URL from the `x-proxy-target` request header and
 * forwards the request using Node's http/https modules (more reliable than
 * the built-in fetch/undici for loopback/localhost targets on Windows).
 * Adds Access-Control-Allow-Origin: * to the response so the browser accepts it.
 *
 * Only active in the dev server — production builds use direct fetch.
 */
const corsProxyPlugin = {
  name: 'cors-proxy',
  configureServer(server) {
    server.middlewares.use('/api/cors-proxy', (req, res) => {
      // Handle CORS preflight that browsers send before cross-origin POST requests
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.statusCode = 204
        res.end()
        return
      }

      const targetUrl = req.headers['x-proxy-target']
      if (!targetUrl) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain')
        res.end('Missing x-proxy-target header')
        return
      }

      let parsed
      try {
        parsed = new URL(targetUrl)
      } catch {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/plain')
        res.end(`Invalid target URL: ${targetUrl}`)
        return
      }

      // Build forwarded headers — strip proxy-specific and connection management fields.
      // Also strip accept-encoding: the Node http module doesn't auto-decompress, so if
      // we forward the browser's "gzip, br" and the upstream sends compressed bytes we
      // can't transparently re-serve them. Dropping the header forces plain text.
      const HOP_BY_HOP = new Set([
        'host', 'x-proxy-target', 'connection', 'transfer-encoding',
        'accept-encoding', 'te', 'trailer', 'upgrade',
      ])
      const forwardHeaders = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (!HOP_BY_HOP.has(key)) forwardHeaders[key] = value
      }
      // Set Host to match the target so the upstream server recognises the request
      forwardHeaders['host'] = parsed.host

      const transport = parsed.protocol === 'https:' ? https : http

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers: forwardHeaders,
        // Use IPv4 explicitly to avoid Node resolving "localhost" → ::1 (IPv6)
        // when the target server only listens on 127.0.0.1.
        family: 4,
      }

      const proxyReq = transport.request(options, (proxyRes) => {
        res.statusCode = proxyRes.statusCode || 200

        // Forward response headers, skip hop-by-hop fields
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key !== 'transfer-encoding') {
            res.setHeader(key, value)
          }
        }
        // Always allow the browser to read this response
        res.setHeader('Access-Control-Allow-Origin', '*')

        proxyRes.pipe(res)
      })

      proxyReq.on('error', (err) => {
        // Only write the head if we haven't started yet
        if (!res.headersSent) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          // Return JSON so the client can parse the error code and message
          res.end(JSON.stringify({
            error: 'proxy_error',
            code: err.code || 'UNKNOWN',
            message: err.message,
            target: targetUrl,
          }))
        }
      })

      // Pipe the incoming request body straight into the proxy request
      req.pipe(proxyReq)
    })
  },
}

export default defineConfig({
  plugins: [react(), corsProxyPlugin],
  optimizeDeps: {
    // pdfjs-dist ships its own worker; pre-bundling it corrupts the worker URL
    exclude: ['pdfjs-dist'],
  },
  worker: {
    format: 'es',
  },
})
