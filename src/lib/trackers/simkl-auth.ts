import { openUrl } from '@tauri-apps/plugin-opener'
import { get } from 'svelte/store'
import packageJson from '../../../package.json'
import {
  simklClientId, simklToken, simklUserAvatar, simklUserName,
  connectedTrackerProviders, forgetTrackerConnection, recordTrackerConnection,
} from './config'
import { trackerHttpFetch } from './tracker-http'

const API = 'https://api.simkl.com'
export const SIMKL_APP_NAME = 'izumi'
export const SIMKL_APP_VERSION = packageJson.version
export const SIMKL_USER_AGENT = `${SIMKL_APP_NAME}/${SIMKL_APP_VERSION} (https://github.com/nickEatsBread/izumi)`

// Simkl permits 10 GETs/sec and one POST/sec per user token, and recommends one in-flight
// origin request at a time. Keep a small safety margin around both windows. This also fixes a
// progress update issuing /sync/history and /sync/add-to-list in the same second.
const GET_GAP_MS = 110
const WRITE_GAP_MS = 1_050
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503])
const MAX_GET_ATTEMPTS = 5
let requestTail: Promise<unknown> = Promise.resolve()
let nextGetAt = 0
let nextWriteAt = 0

export interface SimklPin {
  code: string
  verificationUrl: string
  expiresIn: number
}

export function simklApiUrl(path: string): string {
  const url = new URL(path, API)
  url.searchParams.set('client_id', simklClientId)
  url.searchParams.set('app-name', SIMKL_APP_NAME)
  url.searchParams.set('app-version', SIMKL_APP_VERSION)
  return url.toString()
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function waitFor(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(new DOMException('The request was aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(new DOMException('The request was aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

/** Serialize dynamic SIMKL endpoints and enforce the documented per-method request windows. */
function schedule<T>(method: string, operation: () => Promise<T>): Promise<T> {
  const normalized = method.toUpperCase()
  const run = requestTail.then(async () => {
    const now = Date.now()
    const earliest = normalized === 'GET' ? nextGetAt : nextWriteAt
    if (earliest > now) await wait(earliest - now)
    if (normalized === 'GET') nextGetAt = Date.now() + GET_GAP_MS
    else nextWriteAt = Date.now() + WRITE_GAP_MS
    return operation()
  })
  // A failed request must not poison every request queued after it.
  requestTail = run.then(() => undefined, () => undefined)
  return run
}

function retryAfterMs(response?: Response): number | undefined {
  const value = response?.headers.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

async function request(path: string, init: RequestInit, token?: string): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = {
    Accept: 'application/json',
    'User-Agent': SIMKL_USER_AGENT,
    ...(init.headers as Record<string, string> ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  let lastResponse: Response | undefined
  let lastError: unknown
  const attempts = method === 'GET' ? MAX_GET_ATTEMPTS : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastResponse = await schedule(method, () => trackerHttpFetch(simklApiUrl(path), {
        ...init,
        method,
        headers,
      }, 'Simkl'))
      if (!TRANSIENT_STATUSES.has(lastResponse.status) || attempt === attempts - 1) return lastResponse
    } catch (error) {
      lastError = error
      if (init.signal?.aborted || attempt === attempts - 1) throw error
    }

    const exponential = 1_000 * 2 ** attempt
    const jitter = Math.floor(Math.random() * 1_000)
    await waitFor(Math.max(exponential, retryAfterMs(lastResponse) ?? 0) + jitter, init.signal)
  }
  if (lastResponse) return lastResponse
  throw lastError
}

function clearSimklIdentity() {
  simklToken.set(null)
  simklUserName.set('')
  simklUserAvatar.set('')
  forgetTrackerConnection('simkl')
}

export async function simklFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = get(simklToken)
  if (!token) return null
  // A persisted login can outlive a local/repackaged build that omitted its public Client ID.
  // Treat that as configuration failure, not an empty SIMKL library: list callers can then show
  // an actionable error instead of silently collapsing every SIMKL row.
  if (!simklClientId) throw new Error('This Izumi build is missing its public Simkl Client ID. Restart after configuring PUBLIC_SIMKL_CLIENT_ID.')
  const response = await request(path, init, token)
  // Tokens are long-lived and have no refresh grant. SIMKL documents a 401 as revocation or an
  // invalid token, so retrying it is wasteful; disconnect and let the user run PIN auth again.
  if (response.status === 401) clearSimklIdentity()
  return response
}

function authFailure(status: number): string {
  if (status === 412) return 'Simkl rejected Izumi’s Client ID. Check the app registration.'
  if (status === 429) return 'Simkl is busy. Try connecting again in a moment.'
  if (status >= 500) return 'Simkl is temporarily unavailable. Try again shortly.'
  return `Could not start Simkl sign-in (${status}).`
}

/** Start Simkl's TV/device PIN flow and wait for the user to approve it in their browser. */
export async function connectSimkl(onPin?: (pin: SimklPin) => void): Promise<void> {
  const connectedBefore = connectedTrackerProviders()
  if (!simklClientId) throw new Error('Missing Simkl Client ID (set PUBLIC_SIMKL_CLIENT_ID in .env.local).')
  const start = await request('/oauth/pin', {})
  const pin = await start.json().catch(() => ({})) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    verification_url?: string
    expires_in?: number
    interval?: number
  }
  if (!start.ok || !pin.user_code) throw new Error(authFailure(start.status))
  const state: SimklPin = {
    code: pin.user_code,
    verificationUrl: (() => {
      try {
        // RFC 8628 calls this verification_uri; verification_url is SIMKL's legacy alias.
        const url = new URL(pin.verification_uri || pin.verification_url || 'https://simkl.com/pin')
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
  const interval = Math.max(1, pin.interval ?? 5) * 1000
  while (Date.now() < deadline) {
    await wait(interval)
    const poll = await request(`/oauth/pin/${encodeURIComponent(state.code)}`, {})
    const reply = await poll.json().catch(() => ({})) as {
      access_token?: string
      device_code?: string
      user_code?: string
      error?: string
    }
    if (reply.access_token) {
      simklToken.set(reply.access_token)
      recordTrackerConnection('simkl', connectedBefore)
      await refreshSimklViewer()
      if (!get(simklUserName)) simklUserName.set('Simkl user')
      return
    }
    // SIMKL returns a fresh PIN-shaped response if the original code was consumed/removed.
    // Continuing to poll would silently wait on the wrong authorization attempt.
    if (reply.device_code || (reply.user_code && reply.user_code !== state.code)) {
      throw new Error('The Simkl code expired. Try connecting again.')
    }
    if (poll.status !== 400 && poll.status !== 404 && !poll.ok) {
      throw new Error(authFailure(poll.status))
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
  clearSimklIdentity()
}

/** Test-only reset for the module-level request scheduler. */
export function resetSimklRequestPolicyForTests() {
  requestTail = Promise.resolve()
  nextGetAt = 0
  nextWriteAt = 0
}
