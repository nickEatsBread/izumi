import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get } from 'svelte/store'
import { malToken, malRefresh, malClientId, malUserName } from './config'
import { captureLogin, redirectUri } from './oauth'

function verifier(): string {
  const b = new Uint8Array(64); crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 100)
}
export async function connectMal() {
  if (!malClientId) throw new Error('Missing MAL Client ID (set PUBLIC_MAL_CLIENT_ID in .env).')
  const codeVerifier = verifier() // MAL PKCE is 'plain' -> challenge === verifier
  const malAuthUrl = `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${malClientId}&code_challenge=${codeVerifier}&code_challenge_method=plain&redirect_uri=${encodeURIComponent(redirectUri)}`
  const u = await captureLogin(malAuthUrl)
  const code = u.searchParams.get('code')
  if (!code) throw new Error('No authorization code returned.')
  const res = await httpFetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: malClientId, grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri }).toString(),
  })
  const json = await res.json() as { access_token?: string; refresh_token?: string }
  if (!json.access_token) throw new Error('MAL token exchange failed.')
  malToken.set(json.access_token); malRefresh.set(json.refresh_token ?? null)
  const who = await httpFetch('https://api.myanimelist.net/v2/users/@me?fields=name', { headers: { Authorization: `Bearer ${json.access_token}` } })
  const w = await who.json() as { name?: string }
  malUserName.set(w.name ?? 'MAL user')
}
export function disconnectMal() { malToken.set(null); malRefresh.set(null); malUserName.set('') }

// MAL access tokens expire ~hourly. Exchange the stored refresh token for a new
// access token (and rotate the refresh token). Returns the new access token, or
// null if there's no refresh token / it's been revoked.
export async function refreshMal(): Promise<string | null> {
  const rt = get(malRefresh)
  if (!rt || !malClientId) return null
  try {
    const res = await httpFetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: malClientId, grant_type: 'refresh_token', refresh_token: rt }).toString(),
    })
    if (!res.ok) return null
    const json = await res.json() as { access_token?: string; refresh_token?: string }
    if (!json.access_token) return null
    malToken.set(json.access_token)
    if (json.refresh_token) malRefresh.set(json.refresh_token)
    return json.access_token
  }
  catch { return null }
}

// Authorized MAL request that transparently refreshes the access token once on a
// 401 and retries. Returns null when MAL isn't connected. Use for every
// user-scoped MAL v2 call so hourly token expiry doesn't silently break sync.
export async function malFetch(
  input: string,
  init: Parameters<typeof httpFetch>[1] = {},
): Promise<Response | null> {
  const token = get(malToken)
  if (!token) return null
  const withAuth = (t: string) => ({
    ...init,
    headers: { ...(init?.headers as Record<string, string> ?? {}), Authorization: `Bearer ${t}` },
  })
  let r = await httpFetch(input, withAuth(token))
  if (r.status === 401) {
    const nt = await refreshMal()
    if (!nt) return r
    r = await httpFetch(input, withAuth(nt))
  }
  return r
}
