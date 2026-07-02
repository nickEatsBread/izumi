import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get } from 'svelte/store'
import { anilistToken, anilistClientId, anilistClientSecret, anilistUserName } from './config'
import { deepLinkLogin, redirectUri } from './oauth'

export async function connectAniList() {
  const clientId = get(anilistClientId), clientSecret = get(anilistClientSecret)
  if (!clientId || !clientSecret) throw new Error('Enter your AniList Client ID and Secret first.')
  const cb = await deepLinkLogin((state) =>
    `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`)
  const code = cb.searchParams.get('code')
  if (!code) throw new Error('No authorization code returned.')
  const res = await httpFetch('https://anilist.co/api/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }),
  })
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw new Error('Token exchange failed.')
  anilistToken.set(json.access_token)
  // confirm + capture viewer name via GraphQL (Bearer auto-attached by urql client, but do a direct call here)
  const who = await httpFetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${json.access_token}` },
    body: JSON.stringify({ query: 'query { Viewer { name } }' }),
  })
  const w = await who.json() as { data?: { Viewer?: { name?: string } } }
  anilistUserName.set(w.data?.Viewer?.name ?? 'AniList user')
}
export function disconnectAniList() { anilistToken.set(null); anilistUserName.set('') }
