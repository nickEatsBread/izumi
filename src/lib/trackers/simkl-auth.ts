import { openUrl } from '@tauri-apps/plugin-opener'
import { get } from 'svelte/store'
import { simklClientId, simklToken, simklUserAvatar, simklUserName } from './config'
import { trackerHttpFetch } from './tracker-http'

const API = 'https://api.simkl.com'
const APP_VERSION = '0.1.47'

export interface SimklPin {
  code: string
  verificationUrl: string
  expiresIn: number
}

function apiUrl(path: string): string {
  const url = new URL(path, API)
  url.searchParams.set('client_id', simklClientId)
  url.searchParams.set('app-name', 'izumi')
  url.searchParams.set('app-version', APP_VERSION)
  return url.toString()
}

export async function simklFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = get(simklToken)
  if (!token || !simklClientId) return null
  return trackerHttpFetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': `izumi/${APP_VERSION}`,
      'simkl-api-key': simklClientId,
      ...(init.headers as Record<string, string> ?? {}),
      Authorization: `Bearer ${token}`,
    },
  }, 'Simkl')
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/** Start Simkl's TV/device PIN flow and wait for the user to approve it in their browser. */
export async function connectSimkl(onPin?: (pin: SimklPin) => void): Promise<void> {
  if (!simklClientId) throw new Error('Missing Simkl Client ID (set PUBLIC_SIMKL_CLIENT_ID in .env).')
  const start = await trackerHttpFetch(apiUrl('/oauth/pin'), {
    headers: { Accept: 'application/json', 'simkl-api-key': simklClientId },
  }, 'Simkl')
  const pin = await start.json().catch(() => ({})) as {
    user_code?: string
    verification_url?: string
    expires_in?: number
    interval?: number
  }
  if (!start.ok || !pin.user_code) throw new Error(`Could not start Simkl sign-in (${start.status}).`)
  const state: SimklPin = {
    code: pin.user_code,
    verificationUrl: (() => {
      try {
        const url = new URL(pin.verification_url || 'https://simkl.com/pin')
        return url.protocol === 'https:' && (url.hostname === 'simkl.com' || url.hostname.endsWith('.simkl.com'))
          ? url.toString()
          : 'https://simkl.com/pin'
      } catch { return 'https://simkl.com/pin' }
    })(),
    expiresIn: pin.expires_in ?? 900,
  }
  onPin?.(state)
  await openUrl(state.verificationUrl)

  const deadline = Date.now() + state.expiresIn * 1000
  const interval = Math.max(2, pin.interval ?? 5) * 1000
  while (Date.now() < deadline) {
    await wait(interval)
    const poll = await trackerHttpFetch(apiUrl(`/oauth/pin/${encodeURIComponent(state.code)}`), {
      headers: { Accept: 'application/json', 'simkl-api-key': simklClientId },
    }, 'Simkl')
    const reply = await poll.json().catch(() => ({})) as { access_token?: string; error?: string }
    if (reply.access_token) {
      simklToken.set(reply.access_token)
      await refreshSimklViewer()
      if (!get(simklUserName)) simklUserName.set('Simkl user')
      return
    }
    if (poll.status !== 400 && poll.status !== 404 && !poll.ok) {
      throw new Error(reply.error || `Simkl sign-in failed (${poll.status}).`)
    }
  }
  throw new Error('The Simkl code expired. Try connecting again.')
}

export async function refreshSimklViewer(): Promise<void> {
  const response = await simklFetch('/users/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!response?.ok) return
  const json = await response.json() as {
    user?: { name?: string; username?: string; avatar?: string }
    account?: { name?: string; username?: string; avatar?: string }
    name?: string
    username?: string
    avatar?: string
  }
  const profile = json.user ?? json.account ?? json
  const name = profile.name ?? profile.username
  if (name) simklUserName.set(name)
  simklUserAvatar.set(profile.avatar ?? '')
}

export function disconnectSimkl() {
  simklToken.set(null)
  simklUserName.set('')
  simklUserAvatar.set('')
}
