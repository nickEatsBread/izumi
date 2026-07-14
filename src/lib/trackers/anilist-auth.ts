import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get } from 'svelte/store'
import { anilistToken, anilistClientId, anilistUserName, anilistUserAvatar } from './config'
import { anilistUser } from '$lib/anilist/account'
import { captureLogin, redirectUri } from './oauth'

export async function connectAniList() {
  if (!anilistClientId) throw new Error('Missing AniList Client ID (set PUBLIC_ANILIST_CLIENT_ID in .env).')
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${anilistClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token`
  const u = await captureLogin(authUrl, 'AniList')
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''))
  const token = frag.get('access_token') ?? u.searchParams.get('access_token')
  if (!token) throw new Error('No access token in redirect.')
  anilistToken.set(token)
  await refreshAniListViewer(token)
  if (!get(anilistUserName)) anilistUserName.set('AniList user')
}

// Pull the signed-in viewer's name + avatar with the OAuth token and persist them,
// so the sidebar shows the real profile picture rather than just the name initial.
export async function refreshAniListViewer(token = get(anilistToken)): Promise<void> {
  if (!token) return
  try {
    const who = await httpFetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: 'query { Viewer { name avatar { large medium } } }' }),
    })
    const v = (await who.json() as { data?: { Viewer?: { name?: string; avatar?: { large?: string; medium?: string } } } }).data?.Viewer
    if (!v) return
    if (v.name) anilistUserName.set(v.name)
    anilistUserAvatar.set(v.avatar?.large ?? v.avatar?.medium ?? '')
  }
  catch { /* keep whatever's cached */ }
}

// Resolve the sidebar avatar: the OAuth viewer if connected, otherwise the PUBLIC
// avatar of a manually-entered (read-only) AniList username. Safe no-op if neither.
export async function refreshAniListAvatar(): Promise<void> {
  const token = get(anilistToken)
  if (token) { await refreshAniListViewer(token); return }
  const manual = get(anilistUser)
  if (!manual) return
  try {
    const r = await httpFetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query ($n: String) { User(name: $n) { avatar { large medium } } }', variables: { n: manual } }),
    })
    const a = (await r.json() as { data?: { User?: { avatar?: { large?: string; medium?: string } } } }).data?.User?.avatar
    anilistUserAvatar.set(a?.large ?? a?.medium ?? '')
  }
  catch { /* ignore */ }
}

export function disconnectAniList() { anilistToken.set(null); anilistUserName.set(''); anilistUserAvatar.set('') }
