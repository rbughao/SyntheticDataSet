import { useState, useEffect, useCallback } from 'react'
import { connect, disconnect, readToken } from '../sources/oauth.js'
import { CLOUD_PROVIDERS, loadClientId, saveClientId, fetchProfile } from '../sources/cloudProviders.js'

/**
 * Connection state for the cloud sources.
 *
 * Client IDs persist (they are public identifiers); tokens live in
 * sessionStorage and are re-read on mount so a page refresh inside the same
 * tab keeps the connection.
 */
export function useCloudAuth() {
  const [clientIds, setClientIds] = useState(() =>
    Object.fromEntries(Object.keys(CLOUD_PROVIDERS).map((id) => [id, loadClientId(id)]))
  )
  // { [id]: { status: 'idle'|'connecting'|'connected'|'error', profile?, error? } }
  const [connections, setConnections] = useState(() =>
    Object.fromEntries(Object.keys(CLOUD_PROVIDERS).map((id) => [id, { status: 'idle' }]))
  )

  const setConn = useCallback((id, patch) => {
    setConnections((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }, [])

  // Restore any live token from this tab's session
  useEffect(() => {
    let cancelled = false
    for (const id of Object.keys(CLOUD_PROVIDERS)) {
      if (!readToken(id)) continue
      setConn(id, { status: 'connecting' })
      fetchProfile(id)
        .then((profile) => { if (!cancelled) setConn(id, { status: 'connected', profile, error: null }) })
        .catch(() => { if (!cancelled) setConn(id, { status: 'idle' }) })
    }
    return () => { cancelled = true }
  }, [setConn])

  const updateClientId = useCallback((id, value) => {
    setClientIds((prev) => ({ ...prev, [id]: value }))
    saveClientId(id, value)
  }, [])

  const signIn = useCallback(async (id) => {
    const config = CLOUD_PROVIDERS[id]
    setConn(id, { status: 'connecting', error: null })
    try {
      await connect(config, loadClientId(id))
      const profile = await fetchProfile(id)
      setConn(id, { status: 'connected', profile, error: null })
    } catch (err) {
      setConn(id, { status: 'error', error: err.message })
    }
  }, [setConn])

  const signOut = useCallback((id) => {
    disconnect(id)
    setConn(id, { status: 'idle', profile: null, error: null })
  }, [setConn])

  return { clientIds, connections, updateClientId, signIn, signOut }
}
