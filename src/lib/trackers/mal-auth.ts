import { get } from 'svelte/store'
import { malToken, malRefresh, malTokenExpiry, malClientId, malUserName, malUserAvatar } from './config'
import { captureLogin, redirectUri } from './oauth'
import { malHttpFetch } from './mal-http'

// Persist a MAL token response: set the access token, rotate the refresh token (MAL returns a fresh
// one each refresh), and record expiry ONLY when expires_in is present (so a response that omits it
// doesn't force an immediate proactive refresh next call).
function persistMalTokens(json: { access_token?: string; refresh_token?: string; expires_in?: number }) {
  if (json.access_token) malToken.set(json.access_token)
  if (json.refresh_token) malRefresh.set(json.refresh_token)
  if (json.expires_in != null) malTokenExpiry.set(Date.now() + json.expires_in * 1000)
}

function verifier(): string {
  const b = new Uint8Array(64); crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 100)
}
export async function connectMal() {
  if (!malClientId) throw new Error('Missing MAL Client ID (set PUBLIC_MAL_CLIENT_ID in .env).')
  const codeVerifier = verifier() // MAL PKCE is 'plain' -> challenge === verifier
  const malAuthUrl = `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${malClientId}&code_challenge=${codeVerifier}&code_challenge_method=plain&redirect_uri=${encodeURIComponent(redirectUri)}`
  const u = await captureLogin(malAuthUrl, 'MyAnimeList')
  const code = u.searchParams.get('code')
  if (!code) throw new Error('No authorization code returned.')
  const res = await malHttpFetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: malClientId, grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }).toString(),
  })
  const json = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('MAL token exchange failed.')
  persistMalTokens(json)
  await refreshMalViewer()
  if (!get(malUserName)) malUserName.set('MAL user')
}

// Pull the MAL viewer's name + profile picture and persist them, so the sidebar
// shows the real avatar. Safe no-op when MAL isn't connected (malFetch returns null).
export async function refreshMalViewer(): Promise<void> {
  const who = await malFetch('https://api.myanimelist.net/v2/users/@me?fields=name,picture')
  if (!who || !who.ok) return
  const w = await who.json() as { name?: string; picture?: string }
  if (w.name) malUserName.set(w.name)
  malUserAvatar.set(w.picture ?? '')
}

export function disconnectMal() { malToken.set(null); malRefresh.set(null); malTokenExpiry.set(0); malUserName.set(''); malUserAvatar.set('') }

// One in-flight refresh at a time. MAL SINGLE-USES + ROTATES the refresh token, so a startup burst of
// parallel 401s must NOT each fire a refresh — only the first would succeed and the rest would get
// invalid_grant. All concurrent callers await this same promise.
let refreshInFlight: Promise<string | null> | null = null

// MAL access tokens are long-lived (~31 days) but DO expire. Exchange the stored refresh token for a
// new access token (rotating the refresh token). Returns the new access token, or null. A HARD refresh
// failure (`invalid_grant`: revoked/expired refresh token) is PERMANENT: clear all MAL tokens so the
// UI reverts to "Connect" (re-auth). Network errors, rate limits, 5xx responses, and malformed replies
// are TRANSIENT: keep tokens, return null, and try again later.
export function refreshMal(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  const p = (async () => {
    const rt = get(malRefresh)
    if (!rt || !malClientId) return null // nothing to refresh — don't nuke a possibly-valid access token
    try {
      const res = await malHttpFetch('https://myanimelist.net/v1/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: malClientId, grant_type: 'refresh_token', refresh_token: rt }).toString(),
      })
      const json = await res.json().catch(() => ({})) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        error?: string
      }
      if (!res.ok) {
        if (json.error === 'invalid_grant') disconnectMal()
        return null
      }
      if (!json.access_token) return null
      persistMalTokens(json)
      return json.access_token
    }
    catch { return null } // transient (offline / MAL outage) — keep tokens for a later retry
  })()
  refreshInFlight = p
  p.finally(() => { if (refreshInFlight === p) refreshInFlight = null })
  return p
}

// Authorized MAL request. Refreshes the access token PROACTIVELY when it's within 60s of expiry, and
// REACTIVELY once on a 401 (covers legacy sessions with unknown expiry + clock skew), then retries.
// Returns null when MAL isn't connected. Use for every user-scoped MAL v2 call.
export async function malFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response | null> {
  let token = get(malToken)
  if (!token) return null
  const withAuth = (t: string) => ({
    ...init,
    headers: { ...(init?.headers as Record<string, string> ?? {}), Authorization: `Bearer ${t}` },
  })
  // Proactive: refresh before the request when we know the token is about to expire.
  const exp = get(malTokenExpiry)
  if (exp > 0 && Date.now() >= exp - 60_000) {
    const nt = await refreshMal()
    token = get(malToken)
    if (!token) return null // refresh cleared the session (permanent failure)
    if (nt) token = nt
  }
  let r = await malHttpFetch(input, withAuth(token))
  if (r.status === 401) {
    const nt = await refreshMal()
    if (!nt) return r // refresh failed (tokens already cleared on a permanent failure)
    r = await malHttpFetch(input, withAuth(nt))
  }
  return r
}
