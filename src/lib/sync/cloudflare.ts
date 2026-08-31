import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { CompanionMedia, CompanionPlaybackMode } from '$lib/companion/protocol'
import type { SyncRecord, SyncStatus } from './types'

export const CLOUDFLARE_WORKER_VERSION = '1.3.0'
export const CLOUDFLARE_WORKER_PROTOCOL = 1
export const CLOUDFLARE_DEPLOY_URL =
  'https://deploy.workers.cloudflare.com/?url=https://github.com/nickEatsBread/izumi/tree/main/cloudflare-sync-worker'
export const CLOUDFLARE_UPDATE_GUIDE =
  'https://github.com/nickEatsBread/izumi/tree/main/cloudflare-sync-worker#updating'

export type SyncProvider = 'iroh' | 'cloudflare'

export interface CloudflareSyncConfig {
  enabled: boolean
  endpoint: string
  deviceId: string
  deviceToken: string
  groupKey: string
  workerVersion: string
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

interface WorkerStatus {
  app: 'izumi-sync'
  version: string
  protocol: number
  claimed: boolean
  features?: string[]
}

export interface CloudflareCompanionTransport {
  protocol: 1
  endpoint: string
  pairingId: string
  tvToken: string
  playbackMode: CompanionPlaybackMode
  wakeWhenClosed: boolean
}

export interface CloudflareCompanionRequest {
  pairingId: string
  requestId: string
  media: CompanionMedia
  issuedAt: number
  expiresAt: number
}

export interface CloudflareResolverProfile {
  enabled: boolean
  addons: string[]
  quality: '2160' | '1440' | '1080' | '720' | '480' | '360' | 'any'
  sort: 'quality' | 'seeders' | 'size'
  audioLang: string
  /** Ask an explicitly linked Izumi device only when the Worker has no TV-ready source. */
  connectedDeviceFallback: boolean
}

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

function configReady(config: CloudflareSyncConfig): boolean {
  return !!(config.endpoint && config.deviceId && config.deviceToken && config.groupKey)
}

async function workerRequest<T>(
  endpoint: string,
  path: string,
  init: RequestInit = {},
  token = '',
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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
  if (status.app !== 'izumi-sync' || !Number.isInteger(status.protocol)) {
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

function companionConfig(): CloudflareSyncConfig {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) throw new Error('Connect this phone to your Cloudflare Worker first.')
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
export async function getCloudflareResolverProfile(): Promise<{ profile: CloudflareResolverProfile; updatedAt: number | null }> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!cloudResolverSupported(status)) throw new Error('Update your Izumi Cloudflare Worker before enabling TV source resolving.')
  const result = await workerRequest<{ profile: CloudflareResolverProfile; updatedAt: number | null }>(
    config.endpoint, '/v1/resolver/profile', {}, config.deviceToken,
  )
  return {
    ...result,
    profile: { ...result.profile, connectedDeviceFallback: result.profile.connectedDeviceFallback === true },
  }
}

export async function saveCloudflareResolverProfile(profile: CloudflareResolverProfile): Promise<{ updatedAt: number }> {
  const config = companionConfig()
  const status = await getCloudflareWorkerStatus(config.endpoint)
  if (!cloudResolverSupported(status)) throw new Error('Update your Izumi Cloudflare Worker before enabling TV source resolving.')
  if (profile.connectedDeviceFallback && !connectedResolverSupported(status)) {
    throw new Error('Update your Izumi Cloudflare Worker before enabling connected-device source fallback.')
  }
  return workerRequest<{ updatedAt: number }>(config.endpoint, '/v1/resolver/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  }, config.deviceToken)
}

/** Disabling removes credential-bearing add-on URLs instead of leaving a dormant plaintext copy. */
export async function deleteCloudflareResolverProfile(): Promise<void> {
  const config = companionConfig()
  await workerRequest(config.endpoint, '/v1/resolver/profile', { method: 'DELETE' }, config.deviceToken)
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
    if (status.version !== config.workerVersion) {
      cloudflareSyncConfig.set({ ...config, workerVersion: status.version })
    }
    cloudflareWorkerUpdateAvailable.set(compareVersions(status.version, CLOUDFLARE_WORKER_VERSION) < 0
      ? CLOUDFLARE_WORKER_VERSION
      : '')
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
  cloudflareSyncConfig.set({ ...EMPTY_CONFIG, enabled: true, endpoint: config.endpoint })
}

async function encryptionKey(config: CloudflareSyncConfig): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(config.groupKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptPayload(config: CloudflareSyncConfig, category: string, payload: string): Promise<string> {
  const plain = encoder.encode(payload)
  if (plain.byteLength > MAX_PLAINTEXT_BYTES) throw new Error('Sync data is too large for the Cloudflare Worker.')
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

export async function writeCloudflareRecord(category: string, payload: string): Promise<void> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) throw new Error('This device is not connected to a Cloudflare Worker.')
  const encrypted = await encryptPayload(config, category, payload)
  await workerRequest<{ ok: true }>(config.endpoint, `/v1/records/${category}`, {
    method: 'PUT',
    body: JSON.stringify({ payload: encrypted }),
  }, config.deviceToken)
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
  const records = await Promise.all(result.records.map((record) => decryptPayload(config, category, record)))
  return records.filter((record): record is SyncRecord => !!record)
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

export async function checkCloudflareWorkerUpdate(): Promise<string> {
  const config = get(cloudflareSyncConfig)
  if (!configReady(config)) return ''
  try {
    const status = await getCloudflareWorkerStatus(config.endpoint)
    const available = compareVersions(status.version, CLOUDFLARE_WORKER_VERSION) < 0
      ? CLOUDFLARE_WORKER_VERSION
      : ''
    cloudflareWorkerUpdateAvailable.set(available)
    if (status.version !== config.workerVersion) cloudflareSyncConfig.set({ ...config, workerVersion: status.version })
    return available
  } catch {
    return ''
  }
}

let updateTimer: ReturnType<typeof setInterval> | undefined
export function startCloudflareWorkerUpdateChecks(): void {
  if (updateTimer) return
  setTimeout(() => { void checkCloudflareWorkerUpdate() }, 20_000)
  updateTimer = setInterval(() => { void checkCloudflareWorkerUpdate() }, 6 * 60 * 60_000)
}
