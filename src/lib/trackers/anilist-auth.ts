import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { anilistToken, anilistClientId, anilistUserName } from './config'
import { captureLogin, redirectUri } from './oauth'

export async function connectAniList() {
  if (!anilistClientId) throw new Error('Missing AniList Client ID (set PUBLIC_ANILIST_CLIENT_ID in .env).')
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${anilistClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token`
  const u = await captureLogin(authUrl)
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''))
  const token = frag.get('access_token') ?? u.searchParams.get('access_token')
  if (!token) throw new Error('No access token in redirect.')
  anilistToken.set(token)
  const who = await httpFetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: 'query { Viewer { name } }' }),
  })
  const w = await who.json() as { data?: { Viewer?: { name?: string } } }
  anilistUserName.set(w.data?.Viewer?.name ?? 'AniList user')
}
export function disconnectAniList() { anilistToken.set(null); anilistUserName.set('') }
