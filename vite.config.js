import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite plugin: server-side CORS proxy.
 *
 * Intercepts requests to /api/cors-proxy from the browser.
 * Reads the full target URL from the `x-proxy-target` request header and
 * forwards the request using Node's native fetch (no browser CORS restriction).
 * Adds Access-Control-Allow-Origin: * to the response so the browser accepts it.
 *
 * Only active in the dev server — production builds use direct fetch.
 */
const corsProxyPlugin = {
  name: 'cors-proxy',
  configureServer(server) {
    server.middlewares.use('/api/cors-proxy', async (req, res) => {
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
        res.end('Missing x-proxy-target header')
        return
      }

      // Collect the request body (POST bodies need to be buffered)
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      await new Promise((resolve) => req.on('end', resolve))
      const bodyBuf = chunks.length ? Buffer.concat(chunks) : undefined

      // Forward all headers except proxy-specific and connection management ones
      const forwardHeaders = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (!['host', 'x-proxy-target', 'connection', 'transfer-encoding'].includes(key)) {
          forwardHeaders[key] = value
        }
      }

      try {
        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: bodyBuf && bodyBuf.length > 0 ? bodyBuf : undefined,
        })

        res.statusCode = upstream.status

        // Forward response headers, skip transfer-encoding (we re-buffer the body)
        upstream.headers.forEach((value, key) => {
          if (key !== 'transfer-encoding') res.setHeader(key, value)
        })
        // Always allow the browser to read this response
        res.setHeader('Access-Control-Allow-Origin', '*')

        const responseBody = Buffer.from(await upstream.arrayBuffer())
        res.end(responseBody)
      } catch (err) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'text/plain')
        res.end(`Proxy error: ${err.message}`)
      }
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
