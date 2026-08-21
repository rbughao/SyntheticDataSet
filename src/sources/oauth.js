/**
 * OAuth 2.0 Authorization Code + PKCE, in a popup.
 *
 * One implementation serves both Google and Microsoft, which avoids shipping
 * either GIS or MSAL. PKCE is what makes this safe without a client secret —
 * a secret could not be kept in a browser app anyway.
 *
 * Deliberately no `offline_access` / `prompt=consent` for a refresh token: a
 * refresh token in a browser is a long-lived credential with nowhere safe to
 * live. Access tokens last about an hour and reconnecting is one click.
 */

const STORAGE_PREFIX = 'synthgen_oauth_'

// ── PKCE ───────────────────────────────────────────────────────────────────

function randomString(bytes = 32) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return base64Url(arr)
}

function base64Url(bytes) {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function redirectUri() {
  return `${window.location.origin}/oauth-callback.html`
}

// ── Token storage ──────────────────────────────────────────────────────────
//
// sessionStorage, not localStorage: the token dies with the tab, is not shared
// across tabs, and never outlives the browsing session.

export function readToken(providerId) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + providerId)
    if (!raw) return null
    const token = JSON.parse(raw)
    if (!token.expiresAt || Date.now() >= token.expiresAt) {
      sessionStorage.removeItem(STORAGE_PREFIX + providerId)
      return null
    }
    return token
  } catch {
    return null
  }
}

function writeToken(providerId, token) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + providerId, JSON.stringify(token))
  } catch { /* storage disabled — the token stays in memory for this call only */ }
}

export function clearToken(providerId) {
  try { sessionStorage.removeItem(STORAGE_PREFIX + providerId) } catch { /* ignore */ }
}

// ── Popup round trip ───────────────────────────────────────────────────────

/**
 * Open the provider's consent screen and resolve with the authorization code.
 * Rejects if the user closes the popup, denies consent, or `state` fails to
 * match — the latter being the CSRF check.
 */
function awaitAuthorizationCode(authorizeUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const popup = window.open(authorizeUrl, 'synthgen-oauth', 'width=520,height=680')
    if (!popup) {
      reject(new Error('Popup blocked. Allow popups for this site and try again.'))
      return
    }

    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearInterval(closedTimer)
      try { popup.close() } catch { /* already gone */ }
      fn(arg)
    }

    function onMessage(event) {
      // Only trust our own callback page
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.source !== 'synthgen-oauth') return

      if (data.error) {
        finish(reject, new Error(data.errorDescription || `Sign-in failed: ${data.error}`))
        return
      }
      if (data.state !== expectedState) {
        finish(reject, new Error('Sign-in failed a security check (state mismatch).'))
        return
      }
      if (!data.code) {
        finish(reject, new Error('Sign-in returned no authorization code.'))
        return
      }
      finish(resolve, data.code)
    }

    window.addEventListener('message', onMessage)

    const closedTimer = setInterval(() => {
      if (popup.closed) finish(reject, new Error('Sign-in window was closed.'))
    }, 500)
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the full flow and return a stored token.
 *
 * @param {object} config  provider config from cloudProviders.js
 * @param {string} clientId
 */
export async function connect(config, clientId) {
  if (!clientId) throw new Error(`Enter a ${config.label} client ID first.`)

  const verifier = randomString()
  const challenge = await challengeFor(verifier)
  const state = randomString(16)

  const authUrl = new URL(config.authorizeUrl)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri())
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', config.scopes.join(' '))
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  for (const [k, v] of Object.entries(config.extraAuthParams || {})) {
    authUrl.searchParams.set(k, v)
  }

  const code = await awaitAuthorizationCode(authUrl.href, state)

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  })

  let res
  try {
    res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    // A CORS failure here almost always means the app was registered as the
    // wrong type — token endpoints only send CORS headers for SPA/public clients.
    throw new Error(
      `Could not reach ${config.label}'s token endpoint. Check that the app is ` +
      `registered as a ${config.appTypeHint} and that ${redirectUri()} is an ` +
      `allowed redirect URI.`
    )
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`
    throw new Error(`${config.label} rejected the sign-in: ${detail}`)
  }

  const token = {
    accessToken: data.access_token,
    // Expire a minute early so a request never starts against a dead token
    expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    scope: data.scope || config.scopes.join(' '),
  }
  writeToken(config.id, token)
  return token
}

export function disconnect(providerId) {
  clearToken(providerId)
}

/** Authorized fetch that fails with a clear message once the token expires. */
export async function authorizedFetch(providerId, url, init = {}) {
  const token = readToken(providerId)
  if (!token) throw new Error('Not connected — sign in again.')
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${token.accessToken}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    clearToken(providerId)
    throw new Error('Session expired — sign in again.')
  }
  return res
}
