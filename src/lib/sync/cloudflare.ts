import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { CompanionHomeSnapshot, CompanionMedia, CompanionPlaybackMode } from '$lib/companion/protocol'
import type { SyncRecord, SyncStatus } from './types'
import { chunkHash, MAX_SYNC_BYTES, parseChunkManifest, splitSyncPayload, type ChunkManifest } from './record-chunks'

export const CLOUDFLARE_WORKER_VERSION = '1.13.1'
export const CLOUDFLARE_WORKER_PROTOCOL = 1
export const CLOUDFLARE_GIT_DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=https://github.com/nickEatsBread/izumi/tree/main/cloudflare-sync-worker'
export const CLOUDFLARE_TOKEN_CREATE_URL =
  'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=Izumi%20Worker%20setup'
export const CLOUDFLARE_TOKEN_MANAGE_URL = 'https://dash.cloudflare.com/profile/api-tokens'
export const CLOUDFLARE_TERMS_URL = 'https://www.cloudflare.com/terms/'
export const CLOUDFLARE_PRIVACY_URL = 'https://www.cloudflare.com/privacypolicy/'
export const CLOUDFLARE_UPDATE_GUIDE =
  'https://github.com/nickEatsBread/izumi/tree/main/cloudflare-sync-worker#updating'

export type SyncProvider = 'iroh' | 'cloudflare'

export interface CloudflareDeploymentTarget {
  accountId: string
  scriptName: string
  databaseId: string
}

export interface CloudflareSyncConfig {
  enabled: boolean
  endpoint: string
  deviceId: string
  deviceToken: string
  groupKey: string
  workerVersion: string
  /** Present only on the device that deployed this Worker directly through Izumi. */
  deployment?: CloudflareDeploymentTarget
}

const EMPTY_CONFIG: CloudflareSyncConfig = {
  enabled: false,
  endpoint: '',
  deviceId: '',
  deviceToken: '',
  groupKey: '',
  workerVersion: '',
}

export const syncProvider = persisted<SyncProvider>('sync-provider-v1', 'iroh')
export const cloudflareSyncConfig = persisted<CloudflareSyncConfig>(
  'cloudflare-sync-config-v1',
  EMPTY_CONFIG,
)
/** Kept separately so closing Izumi halfway through Cloudflare's deploy flow does not lose it. */
export const cloudflareSetupSecret = persisted<string>('cloudflare-sync-setup-secret-v1', '')
export const cloudflareWorkerUpdateAvailable = writable<string>('')
/** Private URLs are never accepted implicitly: a public add-on could otherwise make the TV probe
 * arbitrary devices on its LAN. */
export const cloudflareAllowLanSources = persisted<boolean>('cloudflare-allow-lan-sources-v1', false)

interface WorkerStatus {
  app: 'izumi-sync'
  version: string
  protocol: number
  claimed: boolean
  features?: string[]
  recordChunks?: number
  workerUpdate?: number
}

export interface CloudflareAutomaticUpdate {
  version: string
  configured: boolean
  automatic: boolean
  phase: 'setup-required' | 'unchecked' | 'checking' | 'queued' | 'delayed' | 'error' | 'available' | 'current'
  latestVersion: string
  error: string
}

/** The private Worker owns the deployment hook; clients send only their existing device credential. */
export async function triggerCloudflareWorkerUpdate(): Promise<CloudflareAutomaticUpdate | null> {
  const config = get(cloudflareSyncConfig)
  if (!deviceConfigReady(config)) throw new Error('Connect this device to your private Worker first.')
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (status.workerUpdate !== 1) return null
  const current = get(cloudflareSyncConfig)
  if (current.endpoint !== config.endpoint || current.deviceToken !== config.deviceToken) throw new Error('The Worker connection changed.')
  return workerRequest<CloudflareAutomaticUpdate>(config.endpoint, '/v1/worker-update', { method: 'POST' }, config.deviceToken, 25_000)
}

export interface CloudflareCompanionTransport {
  protocol: 1
  endpoint: string
  pairingId: string
  tvToken: string
  /** Recovery encryption secret shared with the TV; never used as a Worker bearer token. */
  recoveryKey?: string
  playbackMode: CompanionPlaybackMode
  wakeWhenClosed: boolean
}

export interface CloudflareCompanionRequest {
  profileId?: string
  pairingId: string
  requestId: string
  media: CompanionMedia
  issuedAt: number
  expiresAt: number
}

export interface CloudflareResolverProfile {
  subtitleServices?: Array<{ kind: 'rest-v1'; base: string; apiKey: string; token?: string; expires?: number }>
  subtitleLang?: string
  subtitleStyle?: Record<string, unknown>
  collections?: import('$lib/catalog/collections/model').HomeCollection[]
  household?: import('$lib/profiles/store').ProfileState
  enabled: boolean
  addons: string[]
  quality: '2160' | '1440' | '1080' | '720' | '480' | '360' | 'any'
  sort: 'quality' | 'seeders' | 'size'
  audioLang: string
  /** Ordered addon origin-id fingerprints (most trusted first); same ids the desktop stores. */
  sourcePriority?: string[]
  sourcePriorityMode?: 'prefer' | 'strict'
  /** Ask an explicitly linked Izumi device only when the Worker has no TV-ready source. */
  connectedDeviceFallback: boolean
  allowPrivateNetworkSources?: boolean
  /** Optional credential used only inside this user's Worker to resolve torrent rows for the TV. */
  debrid: {
    provider: string
    credential: string
  } | null
  /** Runtime-neutral catalogue settings used only when the TV is browsing without Izumi open. */
  catalog?: {
    screens: string[]
    defaultScreen: string
    showAdult: boolean
    hideSpoilers: boolean
    tmdbToken: string
  }
}

export interface CloudflareResolverProfileState extends Omit<CloudflareResolverProfile, 'debrid' | 'catalog' | 'subtitleServices'> {
  subtitleServices?: Array<{ kind: 'rest-v1'; configured: boolean }>
  /** The Worker reports only whether a credential exists; it never echoes the secret. */
  debrid: { provider: string; configured: true } | null
  catalog?: Omit<NonNullable<CloudflareResolverProfile['catalog']>, 'tmdbToken'> & { tmdbConfigured?: boolean }
}

export interface CloudflareCompanionProgress {
  profileId?: string
  recordKey: string
  media: CompanionMedia
  sessionId: string
  positionSeconds: number
  durationSeconds: number
  state: 'buffering' | 'playing' | 'paused' | 'idle'
  completed: boolean
  updatedAt: number
}
type EncryptedCloudflareCompanionProgress = Omit<CloudflareCompanionProgress, 'recordKey'>

interface EncryptedEnvelope {
  v: 1
  iv: string
  data: string
}

interface InviteTicket {
  v: 1
  endpoint: string
  code: string
  key: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const REQUEST_TIMEOUT_MS = 12_000
// Leave room for GCM, base64, the envelope, and the outer request JSON below 512 KiB.
const MAX_RECORD_PLAINTEXT_BYTES = 360 * 1024
// Companion snapshots retain their independent protocol and existing limit.
const MAX_PLAINTEXT_BYTES = 384 * 1024

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomSecret(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return bytesToBase64Url(value)
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('The TV pairing credential is invalid.')
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function deviceId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : randomSecret(18)
}

export function normalizeCloudflareEndpoint(value: string): string {
  const url = new URL(value.trim())
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Use an HTTPS Worker URL.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The Worker URL cannot contain credentials, a query, or a fragment.')
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Use the root URL of the deployed Worker.')
  return url.toString().replace(/\/$/, '')
}

function deviceConfigReady(config: CloudflareSyncConfig): boolean {
  return !!(config.endpoint && config.deviceId && config.deviceToken)
}

function configReady(config: CloudflareSyncConfig): boolean {
  return deviceConfigReady(config) && !!config.groupKey
}

async function workerRequest<T>(
  endpoint: string,
  path: string,
  init: RequestInit = {},
  token = '',
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers)
    if (init.body) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${normalizeCloudflareEndpoint(endpoint)}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({})) as { error?: unknown }
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : `Worker returned ${response.status}.`
      throw new Error(message)
    }
    return body as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The Cloudflare Worker did not respond in time.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function getCloudflareWorkerStatus(endpoint: string): Promise<WorkerStatus> {
  const status = await workerRequest<WorkerStatus>(endpoint, '/v1/status')
  if (status.app !== 'izumi-sync' || !Number.isInteger(status.protocol)
    || typeof status.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(status.version)) {
    throw new Error('This URL is not an Izumi sync Worker.')
  }
  if (status.protocol !== CLOUDFLARE_WORKER_PROTOCOL) {
    throw new Error(`Worker protocol ${status.protocol} is not supported by this Izumi version.`)
  }
  return status
}

function companionWakeSupported(status: WorkerStatus): boolean {
  return status.features?.includes('companion-wake-v1') === true
}

function cloudResolverSupported(status: WorkerStatus): boolean {
  return status.features?.includes('cloud-resolver-v1') === true
}

function connectedResolverSupported(status: WorkerStatus): boolean {
  return status.features?.includes('cloud-resolver-v2') === true
}

function nativeDebridResolverSupported(status: WorkerStatus): boolean {
  return status.features?.includes('cloud-resolver-debrid-v1') === true
}

function companionConfig(): CloudflareSyncConfig {
  const config = get(cloudflareSyncConfig)
  if (!deviceConfigReady(config)) throw new Error('Connect this device to your Cloudflare Worker first.')
  return config
}

/** Create a TV-only capability inside this user's Worker. No Izumi-operated service is involved. */
export async function createCloudflareCompanionPairing(policy: {
  playbackMode: CompanionPlaybackMode
  wakeWhenClosed: boolean
} = { playbackMode: 'device-only', wakeWhenClosed: false }): Promise<CloudflareCompanionTransport> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!companionWakeSupported(status)) {
    throw new Error('Update your Izumi Cloudflare Worker before enabling closed-app TV requests.')
  }
  const pairingId = randomSecret(18)
  const tvToken = randomSecret()
  await workerRequest<{ ok: true }>(config.endpoint, '/v1/companion/pairings', {
    method: 'POST',
    body: JSON.stringify({ pairingId, tvToken }),
  }, config.deviceToken)
  return { protocol: 1, endpoint: config.endpoint, pairingId, tvToken, ...policy }
}

/** The recovery secret is shared only through the encrypted reverse-link flow. */
export function companionTransportForLan(transport: CloudflareCompanionTransport): CloudflareCompanionTransport {
  const { recoveryKey: _recoveryKey, ...publicTransport } = transport
  return publicTransport
}

/** The TV can recover the sync key after a reinstall without giving it the owner's device token. */
async function persistCompanionRecovery(transport: CloudflareCompanionTransport, config: CloudflareSyncConfig): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.groupKey) || base64UrlToBytes(config.groupKey).length !== 32) {
    throw new Error('The sync recovery key is invalid.')
  }
  if (!transport.recoveryKey || !/^[A-Za-z0-9_-]{43}$/.test(transport.recoveryKey) || base64UrlToBytes(transport.recoveryKey).length !== 32) {
    throw new Error('The TV recovery secret is invalid.')
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(transport.recoveryKey), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: encoder.encode(`izumi-companion:${transport.pairingId}:client-recovery`) }, key,
    encoder.encode(JSON.stringify({ v: 1, groupKey: config.groupKey })))
  const payload = JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(data)) })
  const path = `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/client-recovery`
  const result = await workerRequest<{ ok: true; stored?: boolean }>(config.endpoint, path, {
    method: 'PUT', body: JSON.stringify({ payload }),
  }, config.deviceToken)
  if (result.stored === false) {
    try {
      const existing = await workerRequest<{ payload: string | null }>(config.endpoint, path, { method: 'GET' }, config.deviceToken)
      const envelope = JSON.parse(existing.payload ?? '')
      if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('Invalid envelope')
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv),
        additionalData: encoder.encode(`izumi-companion:${transport.pairingId}:client-recovery`) }, key, base64UrlToBytes(envelope.data))
      const saved = JSON.parse(new TextDecoder().decode(plaintext))
      if (saved.v !== 1 || saved.groupKey !== config.groupKey) throw new Error('Different sync key')
    } catch {
      throw new Error('This TV already has a different recovery backup. Its existing backup was preserved; recovery for this client could not be enabled.')
    }
  }
}

export async function saveCloudflareCompanionRecovery(transport: CloudflareCompanionTransport): Promise<boolean> {
  const config = companionConfig()
  if (!config.groupKey || !transport.recoveryKey) return false
  if (normalizeCloudflareEndpoint(config.endpoint) !== normalizeCloudflareEndpoint(transport.endpoint)) return false
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!status.features?.includes('companion-client-link-v1')) return false
  await persistCompanionRecovery(transport, config)
  return true
}

export async function removeCloudflareCompanionPairing(pairingId: string): Promise<void> {
  const config = companionConfig()
  await workerRequest<{ ok: true }>(
    config.endpoint,
    `/v1/companion/pairings/${encodeURIComponent(pairingId)}`,
    { method: 'DELETE' },
    config.deviceToken,
  )
}

/** Revoke with the TV-scoped capability, even if this app has since selected another sync Worker. */
export async function revokeCloudflareCompanionTransport(transport: CloudflareCompanionTransport): Promise<void> {
  await workerRequest<{ ok: true }>(
    transport.endpoint,
    `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}`,
    { method: 'DELETE' },
    transport.tvToken,
  )
}

export async function createCloudflareCompanionEnrollment(): Promise<{ url: string; expiresAt: number }> {
  const config = companionConfig()
  return workerRequest<{ url: string; expiresAt: number }>(config.endpoint, '/v1/companion/enrollments', {
    method: 'POST',
    body: JSON.stringify({}),
  }, config.deviceToken)
}

/** Read the opt-in profile separately from encrypted sync records. Add-on URLs remain visible to
 * the user's Worker because it must contact them while Izumi is closed. */
export async function getCloudflareResolverProfile(): Promise<{ profile: CloudflareResolverProfileState; updatedAt: number | null }> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!cloudResolverSupported(status)) throw new Error('Update your Izumi Cloudflare Worker before enabling TV source resolving.')
  const result = await workerRequest<{ profile: CloudflareResolverProfileState; updatedAt: number | null }>(
    config.endpoint, '/v1/resolver/profile', {}, config.deviceToken,
  )
  return {
    ...result,
    profile: { ...result.profile, connectedDeviceFallback: result.profile.connectedDeviceFallback === true },
  }
}

/** Mirror of the Worker's per-entry add-on validation (HTTPS, no credentials, public hostname).
 * Older Workers reject the ENTIRE profile save over one unusable entry or an over-long list —
 * which silently freezes every later settings change out of the TV — so the client drops exactly
 * what the Worker would refuse and caps the list at the deployed Worker's limit. */
export function sanitizeResolverAddonUrls(urls: string[], limit: number): string[] {
  const cleaned = urls.flatMap((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return []
    try {
      const url = new URL(value.trim().replace(/^stremio:\/\//i, 'https://'))
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) return []
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
        || host.endsWith('.internal') || host.includes(':')) return []
      const octets = host.split('.').map(Number)
      if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        const [a, b] = octets
        if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
          || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return []
      }
      return [value.trim()]
    } catch { return [] }
  })
  return [...new Set(cleaned)].slice(0, limit)
}

export async function saveCloudflareResolverProfile(profile: CloudflareResolverProfile): Promise<{ updatedAt: number }> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!cloudResolverSupported(status)) throw new Error('Update your Izumi Cloudflare Worker before enabling TV source resolving.')
  if (profile.connectedDeviceFallback && !connectedResolverSupported(status)) {
    throw new Error('Update your Izumi Cloudflare Worker before enabling connected-device source fallback.')
  }
  if (profile.debrid && !nativeDebridResolverSupported(status)) {
    throw new Error('Update your Izumi Cloudflare Worker before enabling native TV debrid playback.')
  }
  const limit = status.features?.includes('cloud-resolver-addons-16') === true ? 16 : 8
  const addons = sanitizeResolverAddonUrls(profile.addons, limit)
  if (addons.length < profile.addons.length) {
    console.warn(`[cloudflare] ${profile.addons.length - addons.length} stream source(s) will not sync to the TV Worker (private/invalid URL, or beyond its ${limit}-source limit).`)
  }
  return workerRequest<{ updatedAt: number }>(config.endpoint, '/v1/resolver/profile', {
    method: 'PUT',
    body: JSON.stringify({ ...profile, addons }),
  }, config.deviceToken)
}

/** Disabling removes credential-bearing add-on URLs instead of leaving a dormant plaintext copy. */
export async function deleteCloudflareResolverProfile(): Promise<void> {
  const config = companionConfig()
  await workerRequest(config.endpoint, '/v1/resolver/profile', { method: 'DELETE' }, config.deviceToken)
}

export interface CloudAccountState {
  service: 'nuvio' | 'stremio'; connected: boolean; email: string; profile: number | null;
  sources: boolean; playback: boolean; updatedAt: number | null
}

export async function cloudAccountRequest<T>(profileId: string, input?: Record<string, unknown>): Promise<T> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!status.features?.includes('companion-accounts-v1')) throw new Error('Update your Cloudflare Worker to use TV accounts.')
  return workerRequest<T>(config.endpoint, input ? '/v1/accounts' : `/v1/accounts?profileId=${encodeURIComponent(profileId)}`,
    input ? { method: 'POST', body: JSON.stringify({ ...input, profileId }) } : {}, config.deviceToken)
}

export async function updateCloudflareCompanionRequest(
  pairingId: string,
  requestId: string,
  state: 'opened' | 'accepted' | 'cancelled',
): Promise<void> {
  const config = companionConfig()
  await workerRequest<{ ok: true }>(
    config.endpoint,
    `/v1/companion/pairings/${encodeURIComponent(pairingId)}/requests/${encodeURIComponent(requestId)}/status`,
    { method: 'POST', body: JSON.stringify({ state }) },
    config.deviceToken,
  )
}

function validCompanionMediaRef(value: unknown): value is CompanionMedia['ref'] {
  if (!value || typeof value !== 'object') return false
  const ref = value as Record<string, unknown>
  return ['anilist', 'kitsu', 'tmdb', 'stremio', 'jvm'].includes(String(ref.provider))
    && ['anime', 'manga', 'movie', 'series'].includes(String(ref.type))
    && typeof ref.id === 'string'
    && ref.id.length > 0
    && ref.id.length <= 512
}

export async function readCloudflareCompanionRequest(
  pairingId: string,
  requestId: string,
  credential: string,
): Promise<CloudflareCompanionRequest> {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(pairingId) || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    throw new Error('This TV request link is invalid.')
  }
  const config = companionConfig()
  const record = await workerRequest<{ payload: string; state: string; issuedAt: number; expiresAt: number }>(
    config.endpoint,
    `/v1/companion/pairings/${encodeURIComponent(pairingId)}/requests/${encodeURIComponent(requestId)}`,
    {},
    config.deviceToken,
  )
  if (record.state === 'cancelled' || record.state === 'expired') throw new Error('This TV request is no longer active.')
  try {
    const envelope = JSON.parse(record.payload) as { v?: unknown; iv?: unknown; data?: unknown }
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('invalid envelope')
    const key = await crypto.subtle.importKey('raw', hexToBytes(credential), { name: 'AES-GCM' }, false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: base64UrlToBytes(envelope.iv),
      additionalData: encoder.encode(`izumi-companion:${pairingId}:${requestId}`),
    }, key, base64UrlToBytes(envelope.data))
    const value = JSON.parse(decoder.decode(plain)) as Record<string, unknown>
    if (value.v !== 1 || value.pairingId !== pairingId || value.requestId !== requestId || !validCompanionMediaRef(value.ref)) {
      throw new Error('invalid request')
    }
    const issuedAt = Number(value.issuedAt)
    const expiresAt = Math.min(Number(value.expiresAt), Number(record.expiresAt))
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('expired request')
    }
    const episode = typeof value.episode === 'number' && Number.isFinite(value.episode) && value.episode > 0
      ? value.episode
      : undefined
    const season = typeof value.season === 'number' && Number.isInteger(value.season) && value.season >= 0 && value.season <= 1_000
      ? value.season
      : undefined
    const resolver = value.resolver && typeof value.resolver === 'object'
      && ((value.resolver as Record<string, unknown>).streamType === 'movie'
        || (value.resolver as Record<string, unknown>).streamType === 'series')
      ? { streamType: (value.resolver as { streamType: 'movie' | 'series' }).streamType }
      : undefined
    const playback = value.playback && typeof value.playback === 'object'
      && (value.playback as Record<string, unknown>).selection === 'manual'
      ? {
          selection: 'manual' as const,
          positionSeconds: typeof (value.playback as Record<string, unknown>).positionSeconds === 'number'
            && Number.isFinite((value.playback as Record<string, number>).positionSeconds)
            ? Math.max(0, Math.min((value.playback as Record<string, number>).positionSeconds, 604_800))
            : undefined,
        }
      : undefined
    await updateCloudflareCompanionRequest(pairingId, requestId, 'opened')
    return {
      pairingId,
      requestId,
      profileId: typeof value.profileId === 'string' ? value.profileId : 'default',
      media: { ref: value.ref, resolver, playback, title: '', episode, season },
      issuedAt,
      expiresAt,
    }
  } catch (error) {
    if (error instanceof Error && ['expired request'].includes(error.message)) throw new Error('This TV request has expired.')
    throw new Error('This TV request could not be authenticated.')
  }
}

export async function getCloudflareSyncStatus(): Promise<SyncStatus> {
  const config = get(cloudflareSyncConfig)
  if (!config.enabled) return { state: 'disabled' }
  if (!configReady(config)) return { state: 'ready', endpointId: config.deviceId || 'cloudflare', paired: false }
  try {
    const status = await getCloudflareWorkerStatus(config.endpoint)
    await workerRequest<{ deviceId: string }>(config.endpoint, '/v1/devices/me', {}, config.deviceToken)
    applyCloudflareWorkerStatus(config, status)
    return { state: 'ready', endpointId: config.deviceId, paired: true }
  } catch (error) {
    return { state: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

export function enableCloudflareSync(): void {
  cloudflareSyncConfig.update((config) => ({ ...config, enabled: true }))
}

export function disableCloudflareSync(): void {
  cloudflareSyncConfig.update((config) => ({ ...config, enabled: false }))
}

export function generateCloudflareSetupSecret(): string {
  const secret = randomSecret()
  cloudflareSetupSecret.set(secret)
  return secret
}

export async function claimCloudflareWorker(
  endpointValue: string,
  bootstrapSecret: string,
  deviceName: string,
  deployment?: CloudflareDeploymentTarget,
): Promise<void> {
  const endpoint = normalizeCloudflareEndpoint(endpointValue)
  const secret = bootstrapSecret.trim()
  if (base64UrlToBytes(secret).length < 24) throw new Error('The setup secret is invalid. Generate a new 32-byte secret.')
  const id = deviceId()
  const token = randomSecret()
  const key = randomSecret()
  const status = await getCloudflareWorkerStatus(endpoint)
  await workerRequest<{ ok: true }>(endpoint, '/v1/claim', {
    method: 'POST',
    headers: { 'X-Izumi-Bootstrap': secret },
    body: JSON.stringify({ deviceId: id, deviceToken: token, deviceName }),
  })
  cloudflareSyncConfig.set({
    enabled: true,
    endpoint,
    deviceId: id,
    deviceToken: token,
    groupKey: key,
    workerVersion: status.version,
    deployment,
  })
  cloudflareSetupSecret.set('')
}

function encodeTicket(ticket: InviteTicket): string {
  return `izumi-cloudflare:${bytesToBase64Url(encoder.encode(JSON.stringify(ticket)))}`
}

export function parseCloudflareInvite(ticketValue: string): InviteTicket {
  const value = ticketValue.trim()
  if (!value.startsWith('izumi-cloudflare:')) throw new Error('This is not a Cloudflare sync invite.')
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(value.slice('izumi-cloudflare:'.length)))) as Partial<InviteTicket>
    if (parsed.v !== 1 || typeof parsed.endpoint !== 'string' || typeof parsed.code !== 'string' || typeof parsed.key !== 'string') {
      throw new Error('invalid fields')
    }
    normalizeCloudflareEndpoint(parsed.endpoint)
    if (base64UrlToBytes(parsed.key).length !== 32 || parsed.code.length < 16) throw new Error('invalid key')
    return parsed as InviteTicket
  } catch {
    throw new Error('The Cloudflare sync invite is malformed.')
  }
}

export async function createCloudflareInvite(): Promise<string> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) throw new Error('Connect this device to a Worker first.')
  const result = await workerRequest<{ code: string }>(config.endpoint, '/v1/invites', {
    method: 'POST',
    body: JSON.stringify({}),
  }, config.deviceToken)
  return encodeTicket({ v: 1, endpoint: config.endpoint, code: result.code, key: config.groupKey })
}

export async function joinCloudflareInvite(ticketValue: string, deviceName: string): Promise<void> {
  const ticket = parseCloudflareInvite(ticketValue)
  const id = deviceId()
  const token = randomSecret()
  const status = await getCloudflareWorkerStatus(ticket.endpoint)
  await workerRequest<{ ok: true }>(ticket.endpoint, '/v1/join', {
    method: 'POST',
    body: JSON.stringify({
      code: ticket.code,
      deviceId: id,
      deviceToken: token,
      deviceName,
    }),
  })
  cloudflareSyncConfig.set({
    enabled: true,
    endpoint: normalizeCloudflareEndpoint(ticket.endpoint),
    deviceId: id,
    deviceToken: token,
    groupKey: ticket.key,
    workerVersion: status.version,
  })
}

export async function leaveCloudflareSync(): Promise<void> {
  const config = get(cloudflareSyncConfig)
  if (configReady(config)) {
    await workerRequest<{ ok: true }>(config.endpoint, '/v1/devices/me', { method: 'DELETE' }, config.deviceToken)
  }
  cloudflareSyncConfig.set({
    ...EMPTY_CONFIG,
    enabled: true,
    endpoint: config.endpoint,
    deployment: config.deployment,
  })
}

async function encryptionKey(config: CloudflareSyncConfig): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(config.groupKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function companionEncryptionKey(transport: CloudflareCompanionTransport, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(transport.tvToken), { name: 'AES-GCM' }, false, usages)
}

async function encryptCompanionPayload(
  transport: CloudflareCompanionTransport,
  context: string,
  value: unknown,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = encoder.encode(JSON.stringify(value))
  if (plain.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('The TV snapshot is too large for Cloudflare Sync.')
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: encoder.encode(`izumi-companion:${transport.pairingId}:${context}`),
  }, await companionEncryptionKey(transport, ['encrypt']), plain)
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) })
}

async function decryptCompanionPayload<T>(
  transport: CloudflareCompanionTransport,
  context: string,
  payload: string,
): Promise<T | null> {
  try {
    const envelope = JSON.parse(payload) as Partial<EncryptedEnvelope>
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') return null
    const plain = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv),
      additionalData: encoder.encode(`izumi-companion:${transport.pairingId}:${context}`),
    }, await companionEncryptionKey(transport, ['decrypt']), base64UrlToBytes(envelope.data))
    return JSON.parse(decoder.decode(plain)) as T
  } catch { return null }
}

/** Publish the existing compact home model without exposing its contents to the Worker. */
export async function publishCloudflareCompanionSnapshot(
  transport: CloudflareCompanionTransport,
  snapshot: CompanionHomeSnapshot,
): Promise<void> {
  const screenKey = snapshot.household?.enabled ? `${snapshot.profileId ?? 'default'}~${snapshot.catalog.screen}` : snapshot.catalog.screen
  const payload = await encryptCompanionPayload(transport, `snapshot:${screenKey}`, snapshot)
  const config = companionConfig()
  if (normalizeCloudflareEndpoint(config.endpoint) !== normalizeCloudflareEndpoint(transport.endpoint)) return
  await workerRequest(transport.endpoint, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/snapshots`, {
    method: 'PUT', body: JSON.stringify({ screen: screenKey, payload }),
  }, config.deviceToken)
}

/** Pull encrypted TV checkpoints so they enter the same local-history/position and group-sync path
 * as playback performed by this client. */
export async function readCloudflareCompanionProgress(
  transport: CloudflareCompanionTransport,
): Promise<CloudflareCompanionProgress[]> {
  const config = companionConfig()
  if (normalizeCloudflareEndpoint(config.endpoint) !== normalizeCloudflareEndpoint(transport.endpoint)) return []
  const result = await workerRequest<{ records: Array<{ mediaKey: string; payload: string }> }>(
    transport.endpoint,
    `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/progress`,
    {},
    config.deviceToken,
  )
  const records = (Array.isArray(result.records) ? result.records : []).slice(0, 200).filter((record) =>
    typeof record?.mediaKey === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(record.mediaKey)
    && typeof record.payload === 'string')
  const values = await Promise.all(records.map((record) => decryptCompanionPayload<EncryptedCloudflareCompanionProgress>(
    transport, `progress:${record.mediaKey}`, record.payload,
  )))
  return values.flatMap((value, index): CloudflareCompanionProgress[] => value?.media?.ref
    && typeof value.sessionId === 'string' && Number.isFinite(value.updatedAt)
    ? [{ ...value, recordKey: records[index].mediaKey }]
    : [])
}

async function encryptPayload(config: CloudflareSyncConfig, category: string, payload: string): Promise<string> {
  const plain = encoder.encode(payload)
  if (plain.byteLength > MAX_RECORD_PLAINTEXT_BYTES) throw new Error('Sync data is too large for the Cloudflare Worker.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${category}:${config.deviceId}`) },
    await encryptionKey(config),
    plain,
  )
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) } satisfies EncryptedEnvelope)
}

async function decryptPayload(
  config: CloudflareSyncConfig,
  category: string,
  record: { deviceId: string; payload: string },
): Promise<SyncRecord | null> {
  try {
    const envelope = JSON.parse(record.payload) as Partial<EncryptedEnvelope>
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') return null
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(envelope.iv),
        additionalData: encoder.encode(`${category}:${record.deviceId}`),
      },
      await encryptionKey(config),
      base64UrlToBytes(envelope.data),
    )
    return { deviceId: record.deviceId, payload: decoder.decode(plain) }
  } catch {
    return null
  }
}

type CachedChunk = { id: string; encrypted: string }
const chunkCaches = new Map<string, Map<string, CachedChunk>>()
const recordWrites = new Map<string, Promise<void>>()
const publishedRecords = new Map<string, string>()
const receivedRecords = new Map<string, { encrypted: string; record: SyncRecord }>()
const chunkScope = (config: CloudflareSyncConfig, category: string) => `${config.endpoint}:${config.deviceId}:${config.groupKey}:${category}`

export async function writeCloudflareRecord(category: string, payload: string): Promise<void> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) throw new Error('This device is not connected to a Cloudflare Worker.')
  const scope = chunkScope(config, category)
  // Manual sync and the automatic timer can overlap. Commit in invocation order per record.
  const previous = recordWrites.get(scope) ?? Promise.resolve()
  const writing = previous.catch(() => {}).then(() => writeCloudflarePayload(config, category, payload))
  recordWrites.set(scope, writing)
  try { await writing } finally { if (recordWrites.get(scope) === writing) recordWrites.delete(scope) }
}

async function writeCloudflarePayload(config: CloudflareSyncConfig, category: string, payload: string): Promise<void> {
  const scope = chunkScope(config, category)
  const payloadHash = await chunkHash(payload)
  if (publishedRecords.get(scope) === payloadHash) return
  if (encoder.encode(payload).byteLength > MAX_RECORD_PLAINTEXT_BYTES) {
    const pieces = splitSyncPayload(payload)
    const status = await getCloudflareWorkerStatus(config.endpoint)
    if (status.recordChunks !== 1) throw new Error('Update your Cloudflare Worker in Device sync settings to sync this larger library. Your local history is safe.')
    const scope = chunkScope(config, category)
    const previous = chunkCaches.get(scope) ?? new Map<string, CachedChunk>()
    const next = new Map<string, CachedChunk>()
    const chunks: string[] = []
    for (const piece of pieces) {
      const fingerprint = await chunkHash(piece)
      let chunk = previous.get(fingerprint) ?? next.get(fingerprint)
      if (!chunk) {
        const encrypted = await encryptPayload(config, `${category}:chunk`, piece)
        chunk = { id: await chunkHash(encrypted), encrypted }
        await workerRequest(config.endpoint, `/v1/record-chunks/${category}/${config.deviceId}/${chunk.id}`, {
          method: 'PUT', body: JSON.stringify({ payload: encrypted }),
        }, config.deviceToken)
      }
      next.set(fingerprint, chunk)
      chunks.push(chunk.id)
    }
    const manifest: ChunkManifest = { kind: 'izumi-record-chunks', version: 1, bytes: encoder.encode(payload).byteLength, chunks }
    const encrypted = await encryptPayload(config, category, JSON.stringify(manifest))
    try {
      await workerRequest(config.endpoint, `/v1/records/${category}`, {
        method: 'PUT', body: JSON.stringify({ payload: encrypted, chunks }),
      }, config.deviceToken)
    } catch (cause) {
      // A restored/cleaned Worker might no longer have a cached chunk. The next attempt reuploads
      // the complete snapshot; never publish a partial library or silently discard local records.
      chunkCaches.delete(scope)
      throw cause
    }
    chunkCaches.set(scope, next)
    publishedRecords.set(scope, payloadHash)
    return
  }
  const encrypted = await encryptPayload(config, category, payload)
  await workerRequest<{ ok: true }>(config.endpoint, `/v1/records/${category}`, {
    method: 'PUT',
    body: JSON.stringify({ payload: encrypted }),
  }, config.deviceToken)
  chunkCaches.delete(chunkScope(config, category))
  publishedRecords.set(scope, payloadHash)
}

export async function readCloudflareRecords(category: string): Promise<SyncRecord[]> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) return []
  const result = await workerRequest<{ records: Array<{ deviceId: string; payload: string }> }>(
    config.endpoint,
    `/v1/records/${category}`,
    {},
    config.deviceToken,
  )
  const records: SyncRecord[] = []
  for (const record of result.records) {
    const cacheKey = `${chunkScope(config, category)}:${record.deviceId}`
    const cached = receivedRecords.get(cacheKey)
    if (cached?.encrypted === record.payload) {
      receivedRecords.delete(cacheKey)
      receivedRecords.set(cacheKey, cached)
      records.push(cached.record)
      continue
    }
    const decrypted = await decryptPayload(config, category, record)
    if (!decrypted) continue
    const manifest = parseChunkManifest(decrypted.payload)
    if (!manifest) { records.push(decrypted); continue }
    const nextCache = new Map<string, CachedChunk>()
    const parts: string[] = []
    let bytes = 0
    for (const id of manifest.chunks) {
      const part = await workerRequest<{ payload: string }>(config.endpoint,
        `/v1/record-chunks/${category}/${record.deviceId}/${id}`, {}, config.deviceToken)
      if (await chunkHash(part.payload) !== id) throw new Error('A library chunk failed its integrity check. Retry sync.')
      const plain = await decryptPayload(config, `${category}:chunk`, { deviceId: record.deviceId, payload: part.payload })
      if (!plain) throw new Error('A library chunk could not be authenticated. Retry sync.')
      bytes += encoder.encode(plain.payload).byteLength
      if (bytes > MAX_SYNC_BYTES || bytes > manifest.bytes) throw new Error('The library snapshot exceeds its declared size.')
      parts.push(plain.payload)
      if (record.deviceId === config.deviceId) nextCache.set(await chunkHash(plain.payload), { id, encrypted: part.payload })
    }
    if (bytes !== manifest.bytes) throw new Error('The library snapshot is incomplete. Retry sync.')
    const complete = { deviceId: record.deviceId, payload: parts.join('') }
    records.push(complete)
    // Bound decoded caches by size, so three ordinary devices do not continually evict one
    // another while a household with genuinely huge libraries cannot consume unlimited memory.
    receivedRecords.delete(cacheKey)
    let cacheBytes = [...receivedRecords.values()].reduce((bytes, value) => bytes + value.record.payload.length * 2, 0)
    while (receivedRecords.size && (receivedRecords.size >= 32 || cacheBytes + complete.payload.length * 2 > MAX_SYNC_BYTES * 2)) {
      const oldest = receivedRecords.keys().next().value!
      cacheBytes -= receivedRecords.get(oldest)!.record.payload.length * 2
      receivedRecords.delete(oldest)
    }
    receivedRecords.set(cacheKey, { encrypted: record.payload, record: complete })
    if (record.deviceId === config.deviceId) chunkCaches.set(chunkScope(config, category), nextCache)
  }
  return records
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] || 0) - (b[index] || 0)
    if (delta) return delta
  }
  return 0
}

/** Ignore replies for a connection that was replaced while its status request was in flight. */
function applyCloudflareWorkerStatus(config: CloudflareSyncConfig, status: WorkerStatus): string {
  const current = get(cloudflareSyncConfig)
  if (current.endpoint !== config.endpoint || current.deviceId !== config.deviceId
    || current.deviceToken !== config.deviceToken || current.groupKey !== config.groupKey) return ''
  const available = compareVersions(status.version, CLOUDFLARE_WORKER_VERSION) < 0
    ? CLOUDFLARE_WORKER_VERSION
    : ''
  cloudflareWorkerUpdateAvailable.set(available)
  if (status.version !== current.workerVersion) {
    cloudflareSyncConfig.set({ ...current, workerVersion: status.version })
  }
  return available
}

export async function checkCloudflareWorkerUpdate(options: { throwOnError?: boolean } = {}): Promise<string> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) {
    cloudflareWorkerUpdateAvailable.set('')
    if (options.throwOnError) throw new Error('Connect this device to a Worker first.')
    return ''
  }
  try {
    const status = await getCloudflareWorkerStatus(config.endpoint)
    return applyCloudflareWorkerStatus(config, status)
  } catch (error) {
    if (options.throwOnError) throw error
    return ''
  }
}

let updateTimer: ReturnType<typeof setInterval> | undefined
export function startCloudflareWorkerUpdateChecks(): void {
  if (updateTimer) return
  setTimeout(() => { void checkCloudflareWorkerUpdate() }, 20_000)
  updateTimer = setInterval(() => { void checkCloudflareWorkerUpdate() }, 6 * 60 * 60_000)
}

export interface CloudflareDiscoveryChoice {
  profileId: string
  media: import('$lib/companion/protocol').CompanionMedia
  action: 'save' | 'skip' | 'dismiss' | 'undo'
  at: number
}
export async function readCloudflareDiscoveryChoices(transport: CloudflareCompanionTransport): Promise<CloudflareDiscoveryChoice[]> {
  const config = companionConfig()
  if (normalizeCloudflareEndpoint(config.endpoint) !== normalizeCloudflareEndpoint(transport.endpoint)) return []
  const result = await workerRequest<{ records?: Array<{ mediaKey: string; payload: string }> }>(
    transport.endpoint, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/discovery`, {}, config.deviceToken,
  )
  const rows = (Array.isArray(result.records) ? result.records : []).slice(0, 500)
    .filter(row => typeof row?.mediaKey === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(row.mediaKey) && typeof row.payload === 'string')
  const choices = await Promise.all(rows.map(row => decryptCompanionPayload<CloudflareDiscoveryChoice>(transport, `discovery:${row.mediaKey}`, row.payload)))
  return choices.filter((choice): choice is CloudflareDiscoveryChoice => !!choice && typeof choice.profileId === 'string'
    && ['save', 'skip', 'dismiss', 'undo'].includes(choice.action) && Number.isFinite(choice.at)
    && !!choice.media?.ref && typeof choice.media.title === 'string')
}
