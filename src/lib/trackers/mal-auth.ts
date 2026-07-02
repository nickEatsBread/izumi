import { fetch as httpFetch } from '@tauri-apps/plugin-http'
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
