import { get } from 'svelte/store'
import {
  kitsuRefresh, kitsuToken, kitsuTokenExpiry, kitsuUserAvatar, kitsuUserId, kitsuUserName,
  connectedTrackerProviders, forgetTrackerConnection, recordTrackerConnection,
} from './config'
import { trackerHttpFetch } from './tracker-http'

const TOKEN_URL = 'https://kitsu.io/api/oauth/token'
const API = 'https://kitsu.io/api/edge'

interface KitsuTokenReply {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
  error?: string
  error_description?: string
}

function persistTokens(reply: KitsuTokenReply) {
  if (reply.access_token) kitsuToken.set(reply.access_token)
  if (reply.refresh_token) kitsuRefresh.set(reply.refresh_token)
  if (reply.expires_in != null) {
    const issued = reply.created_at ? reply.created_at * 1000 : Date.now()
    kitsuTokenExpiry.set(issued + reply.expires_in * 1000)
  }
}

async function tokenRequest(body: Record<string, string>): Promise<KitsuTokenReply> {
  const response = await trackerHttpFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }, 'Kitsu')
  const reply = await response.json().catch(() => ({})) as KitsuTokenReply
  if (!response.ok || !reply.access_token) {
    throw new Error(reply.error_description || reply.error || `Kitsu sign-in failed (${response.status})`)
  }
  return reply
}

/** Kitsu's official first-party-client flow. The password is exchanged once and never persisted. */
export async function connectKitsu(username: string, password: string): Promise<void> {
  const connectedBefore = connectedTrackerProviders()
  if (!username.trim() || !password) throw new Error('Enter your Kitsu username/email and password.')
  const reply = await tokenRequest({ grant_type: 'password', username: username.trim(), password })
  persistTokens(reply)
  recordTrackerConnection('kitsu', connectedBefore)
  await refreshKitsuViewer()
  if (!get(kitsuUserName)) kitsuUserName.set(username.trim())
}

export function disconnectKitsu() {
  kitsuToken.set(null)
  kitsuRefresh.set(null)
  kitsuTokenExpiry.set(0)
  kitsuUserId.set('')
  kitsuUserName.set('')
  kitsuUserAvatar.set('')
  forgetTrackerConnection('kitsu')
}

let refreshInFlight: Promise<string | null> | null = null
export function refreshKitsuToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  const pending = (async () => {
    const refresh = get(kitsuRefresh)
    if (!refresh) return null
    try {
      const reply = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
      persistTokens(reply)
      return reply.access_token ?? null
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      if (message.includes('invalid_grant') || message.includes('invalid refresh')) disconnectKitsu()
      return null
    }
  })()
  refreshInFlight = pending
  pending.finally(() => { if (refreshInFlight === pending) refreshInFlight = null })
  return pending
}

export async function kitsuFetch(input: string, init: RequestInit = {}): Promise<Response | null> {
  let token = get(kitsuToken)
  if (!token) return null
  if (get(kitsuTokenExpiry) > 0 && Date.now() >= get(kitsuTokenExpiry) - 60_000) {
    token = await refreshKitsuToken() ?? get(kitsuToken)
    if (!token) return null
  }
  const request = (accessToken: string) => trackerHttpFetch(input, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      ...(init.headers as Record<string, string> ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  }, 'Kitsu')
  let response = await request(token)
  if (response.status === 401) {
    const refreshed = await refreshKitsuToken()
    if (refreshed) response = await request(refreshed)
  }
  return response
}

export async function refreshKitsuViewer(): Promise<void> {
  const response = await kitsuFetch(`${API}/users?filter%5Bself%5D=true`)
  if (!response?.ok) return
  const json = await response.json() as {
    data?: Array<{ id?: string; attributes?: { name?: string; avatar?: { original?: string; small?: string; tiny?: string } } }>
  }
  const viewer = json.data?.[0]
  if (viewer?.id) kitsuUserId.set(viewer.id)
  if (viewer?.attributes?.name) kitsuUserName.set(viewer.attributes.name)
  kitsuUserAvatar.set(viewer?.attributes?.avatar?.original ?? viewer?.attributes?.avatar?.small ?? viewer?.attributes?.avatar?.tiny ?? '')
}
