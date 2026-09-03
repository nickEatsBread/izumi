import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { trackerHttpFetch } from '$lib/trackers/tracker-http'

const STREMIO_API = 'https://api.strem.io/api'

export interface StremioAddonDescriptor {
  manifest: Record<string, unknown> & { id?: string; name?: string; version?: string }
  transportUrl: string
  flags?: Record<string, unknown> & { official?: boolean; protected?: boolean }
  [key: string]: unknown
}

export interface StremioAddonCollection {
  addons: StremioAddonDescriptor[]
  lastModified?: string
}

interface StremioApiErrorBody {
  message?: unknown
  code?: unknown
}

interface StremioApiEnvelope<T> {
  result?: T
  error?: StremioApiErrorBody
}

interface StremioLoginResult {
  authKey?: unknown
  user?: {
    _id?: unknown
    id?: unknown
    email?: unknown
  }
}

export class StremioApiError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'StremioApiError'
    this.code = code
  }
}

// Runtime account state follows the same device-local persistence model as the existing tracker
// accounts. The token key deliberately contains "token" so normal Izumi backups exclude it.
export const stremioAuthKey = persisted<string | null>('stremio-account-token', null)
export const stremioAccountEmail = persisted<string>('stremio-account-email', '')
export const stremioAccountId = persisted<string>('stremio-account-id', '')

function sensitiveValues(body: Record<string, unknown>): string[] {
  return ['authKey', 'password', 'token']
    .map((key) => body[key])
    .filter((value): value is string => typeof value === 'string' && value.length >= 4)
}

function redact(message: string, values: readonly string[]): string {
  let safe = message
  for (const value of values) safe = safe.split(value).join('[redacted]')
  return safe
}

async function request<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const secrets = sensitiveValues(body)
  let response: Response
  try {
    response = await trackerHttpFetch(`${STREMIO_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }, 'Stremio')
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), secrets))
  }

  let envelope: StremioApiEnvelope<T>
  try {
    envelope = await response.json() as StremioApiEnvelope<T>
  } catch {
    throw new Error(`Stremio returned an invalid response (${response.status}).`)
  }
  if (envelope.error) {
    const code = typeof envelope.error.code === 'number' ? envelope.error.code : undefined
    const message = typeof envelope.error.message === 'string'
      ? redact(envelope.error.message, secrets)
      : `Stremio rejected the request${code == null ? '' : ` (${code})`}.`
    throw new StremioApiError(message, code)
  }
  if (!response.ok || !Object.hasOwn(envelope, 'result')) {
    throw new Error(`Stremio request failed (${response.status}).`)
  }
  return envelope.result as T
}

/** Email/password login used by Stremio Core. The password is never persisted. */
export async function connectStremio(email: string, password: string): Promise<void> {
  const normalizedEmail = email.trim()
  if (!normalizedEmail || !password) throw new Error('Enter your Stremio email and password.')
  const result = await request<StremioLoginResult>('login', {
    type: 'Login',
    email: normalizedEmail,
    password,
    facebook: false,
  })
  if (typeof result.authKey !== 'string' || !result.authKey) {
    throw new Error('Stremio signed in without returning a session key.')
  }
  const remoteEmail = typeof result.user?.email === 'string' ? result.user.email : normalizedEmail
  const remoteId = typeof result.user?._id === 'string' ? result.user._id
    : typeof result.user?.id === 'string' ? result.user.id
      : remoteEmail.toLowerCase()
  stremioAccountEmail.set(remoteEmail)
  stremioAccountId.set(remoteId)
  stremioAuthKey.set(result.authKey)
}

/** Clear the local session even when Stremio is offline; remote logout is best effort. */
export async function disconnectStremio(): Promise<void> {
  const authKey = get(stremioAuthKey)
  stremioAuthKey.set(null)
  stremioAccountEmail.set('')
  stremioAccountId.set('')
  if (!authKey) return
  await request('logout', { type: 'Logout', authKey }).catch(() => undefined)
}

function currentAuthKey(): string {
  const authKey = get(stremioAuthKey)
  if (!authKey) throw new Error('Connect a Stremio account first.')
  return authKey
}

export async function pullStremioAddons(): Promise<StremioAddonCollection> {
  const result = await request<Partial<StremioAddonCollection>>('addonCollectionGet', {
    type: 'AddonCollectionGet',
    authKey: currentAuthKey(),
    update: true,
  })
  if (!Array.isArray(result.addons)) throw new Error('Stremio returned an invalid add-on collection.')
  return {
    addons: result.addons.filter((item): item is StremioAddonDescriptor =>
      !!item && typeof item === 'object' && typeof item.transportUrl === 'string'),
    lastModified: typeof result.lastModified === 'string' ? result.lastModified : undefined,
  }
}

export async function pushStremioAddons(addons: readonly StremioAddonDescriptor[]): Promise<void> {
  await request('addonCollectionSet', {
    type: 'AddonCollectionSet',
    authKey: currentAuthKey(),
    addons: [...addons],
  })
}
