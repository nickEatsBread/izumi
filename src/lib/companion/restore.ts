import { get } from 'svelte/store'
import { cloudflareSyncConfig, normalizeCloudflareEndpoint, type CloudflareCompanionTransport, type CloudflareResolverProfile, type CloudflareSyncConfig } from '$lib/sync/cloudflare'
import type { PairedCompanion } from './client'
import type { ManualDevice } from '$lib/sync/types'
import type { ProfileState } from '$lib/profiles/store'
import { COMPANION_RESTORE_STORAGE_KEY, setCompanionRestorePending } from './restore-state'

export const LIMITED_RECOVERY_WARNING = 'Limited recovery: saved TV setup and TV progress are available. Full encrypted sync is disabled because its key is unavailable. Join a valid full-sync invitation later to recover older encrypted data.'
const STORAGE_KEY = COMPANION_RESTORE_STORAGE_KEY
const CLAIM_KEY = 'companion-client-claim-v1'
const encoder = new TextEncoder()
const invalid = () => new Error('The TV restore data is invalid. Keep this page open and try again, or create a new restore code on the TV.')
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}

export function normalizeRestoreCode(value: string): string {
  // Check before uppercasing: Unicode case folding must not turn other characters into valid codes.
  if (!/^[a-zA-Z2-9\s-]*$/.test(value)) throw new Error('Use the 20-character restore code shown on your TV.')
  const code = value.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/.test(code)) throw new Error('Use the 20-character restore code shown on your TV.')
  return code
}

/** Root public HTTPS origins only. URL canonicalization also catches integer/hex IPv4 literals. */
export function normalizeRestoreEndpoint(value: string): string {
  try {
    const endpoint = normalizeCloudflareEndpoint(value)
    const url = new URL(endpoint)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || host.startsWith('[') || !host.includes('.')
      || /(?:^|\.)(?:localhost|local|lan|internal|home|test|invalid)$/.test(host)
      || host.endsWith('.home.arpa')) throw invalid()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b, c] = host.split('.').map(Number)
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113)) throw invalid()
    }
    return endpoint
  } catch { throw new Error('Use a public HTTPS Worker address with no path, credentials, query, or fragment.') }
}

/** Navigation alone never claims a code. Query codes are moved into the local fragment. */
export function parseCompanionRestoreLink(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'izumi:' || url.hostname !== 'companion' || url.pathname !== '/restore'
      || url.username || url.password || url.port) return null
    const fragment = new URLSearchParams(url.hash.slice(1))
    if (url.searchParams.getAll('worker').length !== 1 || url.searchParams.getAll('code').length > 1 || fragment.getAll('code').length > 1) return null
    const worker = normalizeRestoreEndpoint(url.searchParams.get('worker') ?? '')
    const queryCode = url.searchParams.get('code')
    const fragmentCode = fragment.get('code')
    const code = normalizeRestoreCode(fragmentCode ?? queryCode ?? '')
    if (queryCode != null && normalizeRestoreCode(queryCode) !== code) return null
    return `/app/companion-restore?${new URLSearchParams({ worker })}#${new URLSearchParams({ code })}`
  } catch { return null }
}

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decode(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw invalid()
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0))
  if (encode(bytes) !== value || (length != null && bytes.length !== length)) throw invalid()
  return bytes
}
const random = (length: number) => encode(crypto.getRandomValues(new Uint8Array(length)))
const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))

async function decrypt(encrypted: unknown, secret: Uint8Array<ArrayBuffer>, aad: string): Promise<Record<string, unknown>> {
  try {
    if (typeof encrypted !== 'string' || encrypted.length > 1024 * 1024) throw invalid()
    const envelope = object(JSON.parse(encrypted))
    if (envelope.v !== 1) throw invalid()
    const iv = decode(envelope.iv, 12)
    const data = decode(envelope.data)
    if (data.length < 16) throw invalid()
    const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, data)
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)))
  } catch { throw invalid() }
}

function validateProfile(value: unknown): CloudflareResolverProfile | null {
  if (value === null) return null
  const profile = object(value)
  if (typeof profile.enabled !== 'boolean' || !Array.isArray(profile.addons) || profile.addons.length > 500
    || !profile.addons.every(url => typeof url === 'string' && url.length <= 8192)
    || !['2160', '1440', '1080', '720', '480', '360', 'any'].includes(String(profile.quality))
    || !['quality', 'seeders', 'size'].includes(String(profile.sort))
    || typeof profile.audioLang !== 'string' || profile.audioLang.length > 100
    || typeof profile.connectedDeviceFallback !== 'boolean'
    || (profile.allowPrivateNetworkSources !== undefined && typeof profile.allowPrivateNetworkSources !== 'boolean')) throw invalid()
  if (profile.debrid !== null) {
    const debrid = object(profile.debrid)
    if (typeof debrid.provider !== 'string' || !debrid.provider || typeof debrid.credential !== 'string' || debrid.credential.length > 8192) throw invalid()
  }
  if (profile.catalog !== undefined) {
    const catalog = object(profile.catalog)
    if (!Array.isArray(catalog.screens) || !catalog.screens.every(s => typeof s === 'string')
      || typeof catalog.defaultScreen !== 'string' || typeof catalog.showAdult !== 'boolean'
      || typeof catalog.hideSpoilers !== 'boolean' || typeof catalog.tmdbToken !== 'string') throw invalid()
  }
  if (profile.collections !== undefined && !Array.isArray(profile.collections)) throw invalid()
  if (profile.household !== undefined) {
    const household = object(profile.household)
    if (!Array.isArray(household.profiles) || !household.profiles.length || household.profiles.length > 8) throw invalid()
    const ids = new Set<string>()
    for (const value of household.profiles) {
      const p = object(value)
      if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id)
        || typeof p.name !== 'string' || !p.name.trim() || !Number.isFinite(p.createdAt)) throw invalid()
      ids.add(p.id)
      if (p.pin !== undefined) {
        const pin = object(p.pin)
        if (typeof pin.salt !== 'string' || !/^[0-9a-f]{32}$/i.test(pin.salt)
          || typeof pin.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(pin.hash)) throw invalid()
      }
    }
    // Never let the household normalizer synthesize an unprotected main profile.
    if (!ids.has('default')) throw invalid()
  }
  return profile as unknown as CloudflareResolverProfile
}

export interface TvRestoreSession {
  v: 1
  config: CloudflareSyncConfig
  device: PairedCompanion
  profile: CloudflareResolverProfile | null
  ownerDeviceId: string
  limitedRecovery: boolean
  stage: 'validated' | 'profile' | 'linked'
  settingsRestored?: boolean
  progressRestored?: boolean
  /** The existing local group key still needs to be stored under the TV's securely received key. */
  recoverySeedPending?: boolean
}

export async function validateRestoreClaim(response: unknown, endpointInput: string, codeInput: string,
  identity: { deviceId: string; deviceToken: string }): Promise<TvRestoreSession> {
  const endpoint = normalizeRestoreEndpoint(endpointInput), code = normalizeRestoreCode(codeInput)
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(identity.deviceId)) throw invalid()
  decode(identity.deviceToken, 32)
  const body = object(response)
  if (typeof body.ownerDeviceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.ownerDeviceId)
    || typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(body.version)) throw invalid()
  const payload = await decrypt(body.payload, await sha256(`izumi-client-link-key-v1:${code}`), `izumi-client-link-v1:${endpoint}`)
  if (payload.v !== 1 || typeof payload.deviceId !== 'string' || !/^[0-9a-f]{24}$/i.test(payload.deviceId)
    || typeof payload.credential !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.credential)
    || identity.deviceId === payload.deviceId || identity.deviceId === body.ownerDeviceId) throw invalid()
  const transport = object(payload.transport)
  if (transport.protocol !== 1 || typeof transport.endpoint !== 'string' || normalizeRestoreEndpoint(transport.endpoint) !== endpoint
    || typeof transport.pairingId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(transport.pairingId)
    || !['device-only', 'cloud-only', 'cloud-and-device'].includes(String(transport.playbackMode))
    || typeof transport.wakeWhenClosed !== 'boolean') throw invalid()
  decode(transport.tvToken, 32)
  const recoveryKey = transport.recoveryKey === undefined ? undefined : decode(transport.recoveryKey, 32)
  const limitedRecovery = body.recovery == null || !recoveryKey
  let groupKey = ''
  if (body.recovery != null && recoveryKey) {
    const recovery = await decrypt(body.recovery, recoveryKey, `izumi-companion:${transport.pairingId}:client-recovery`)
    if (recovery.v !== 1) throw invalid()
    groupKey = encode(decode(recovery.groupKey, 32))
  }
  const profile = validateProfile(body.profile)
  // Pure collection normalization can still reject a malformed profile before any stores load.
  if (profile?.collections?.length) {
    const { parseCollectionImport } = await import('$lib/catalog/collections/model')
    try { profile.collections = parseCollectionImport(JSON.stringify(profile.collections)).collections } catch { throw invalid() }
  }
  return {
    v: 1, stage: 'validated', limitedRecovery, ownerDeviceId: body.ownerDeviceId, profile,
    config: { enabled: !limitedRecovery, endpoint, ...identity, groupKey, workerVersion: body.version },
    device: { deviceId: payload.deviceId, name: 'Samsung TV', address: '', credential: payload.credential,
      pairedAt: Date.now(), cloudflare: { ...transport, endpoint } as unknown as CloudflareCompanionTransport },
  }
}

// Retain a successful one-use response if validation, chunk loading, or durable storage fails.
type PendingClaim = {
  endpoint: string
  token: string
  identity: { deviceId: string; deviceToken: string }
  /** Local journal only. Never included in the claim request or a LAN message. */
  existingGroupKey?: string
  response?: unknown
}
let claim: PendingClaim | undefined
let linking: Promise<TvRestoreSession> | undefined
let memorySession: TvRestoreSession | null = null

function saveSession(session: TvRestoreSession): void {
  if (session.stage !== 'linked') {
    // Retain validated credentials on write failure, and keep existing background work paused.
    memorySession = session
    setCompanionRestorePending(true)
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  memorySession = session
  setCompanionRestorePending(session.stage !== 'linked')
}

function savedClaim(): PendingClaim | undefined {
  if (claim) return claim
  const raw = sessionStorage.getItem(CLAIM_KEY)
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as PendingClaim
    normalizeRestoreEndpoint(value.endpoint)
    decode(value.token, 32); decode(value.identity.deviceToken, 32)
    if (value.existingGroupKey !== undefined) decode(value.existingGroupKey, 32)
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(value.identity.deviceId)) throw invalid()
    return value
  } catch { throw new Error('The pending claim could not be read. Keep this page open to preserve your restore attempt.') }
}

export function pendingTvRestore(): TvRestoreSession | null {
  if (memorySession) return memorySession
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as TvRestoreSession
    if (session.v !== 1 || !['validated', 'profile', 'linked'].includes(session.stage)
      || normalizeRestoreEndpoint(session.config.endpoint) !== session.config.endpoint
      || !/^[A-Za-z0-9_-]{16,100}$/.test(session.config.deviceId)
      || !/^[0-9a-f]{24}$/i.test(session.device.deviceId) || !/^[0-9a-f]{64}$/i.test(session.device.credential)
      || session.device.cloudflare?.endpoint !== session.config.endpoint) throw invalid()
    decode(session.config.deviceToken, 32); decode(session.device.cloudflare.tvToken, 32)
    if (session.device.cloudflare.recoveryKey !== undefined) decode(session.device.cloudflare.recoveryKey, 32)
    if (session.limitedRecovery) {
      if (session.config.groupKey !== '' || session.config.enabled) throw invalid()
    } else decode(session.config.groupKey, 32)
    if (session.recoverySeedPending && (session.limitedRecovery || !session.config.enabled
      || !session.device.cloudflare.recoveryKey || session.stage === 'linked')) throw invalid()
    validateProfile(session.profile)
    memorySession = session
    return session
  } catch { throw new Error('The saved TV restore could not be read. Your existing sync settings have not been replaced.') }
}

async function runtime() {
  const [sync, companion, profiles] = await Promise.all([
    import('$lib/sync/client'), import('./client'), import('$lib/profiles/store'),
  ])
  return { sync, companion, profiles }
}

function existingGroupKey(config: CloudflareSyncConfig, endpoint: string): string | undefined {
  try {
    if (!config.enabled || normalizeRestoreEndpoint(config.endpoint) !== endpoint) return undefined
    return encode(decode(config.groupKey, 32))
  } catch { return undefined }
}

/** Only call from a deliberate Link and restore action. No group or watch data is published here. */
export function linkAndRestoreTv(endpointInput: string, codeInput: string, deviceName: string): Promise<TvRestoreSession> {
  if (linking) return linking
  linking = (async () => {
    const saved = pendingTvRestore()
    if (saved) { saveSession(saved); return saved }
    const endpoint = normalizeRestoreEndpoint(endpointInput), code = normalizeRestoreCode(codeInput)
    const previousConfig = { ...get(cloudflareSyncConfig) }
    const token = encode(await sha256(code))
    claim = savedClaim()
    if (claim?.response !== undefined && (claim.endpoint !== endpoint || claim.token !== token)) {
      throw new Error('A successful claim is waiting to be saved. Retry with the same Worker address and code.')
    }
    if (!claim || claim.endpoint !== endpoint || claim.token !== token) {
      claim = { endpoint, token, identity: { deviceId: random(24), deviceToken: random(32) },
        existingGroupKey: existingGroupKey(previousConfig, endpoint) }
    }
    // Journal only the code hash and this new identity. No live sync/settings stores change.
    // Persist BEFORE the one-use request so an ambiguous network result retries with the same identity.
    sessionStorage.setItem(CLAIM_KEY, JSON.stringify(claim))
    if (claim.response === undefined) {
      const response = await fetch(`${endpoint}/v1/companion/client-links/claim`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ token, ...claim.identity, deviceName: deviceName.trim().slice(0, 80) || 'Izumi device' }),
      })
      if (!response.ok) throw new Error(response.status === 404 || response.status === 409 || response.status === 410
        ? 'This restore code is unavailable or already used. Create a new code on the TV.'
        : `The Worker could not link this device (${response.status}). Try again.`)
      claim.response = await response.json()
      sessionStorage.setItem(CLAIM_KEY, JSON.stringify(claim))
    }
    const session = await validateRestoreClaim(claim.response, endpoint, code, claim.identity)
    // Reuse only after authenticating the entire reverse-link payload, including the TV-created
    // recovery key. A present but unreadable envelope must never downgrade to a local candidate.
    if (object(claim.response).recovery == null && session.device.cloudflare?.recoveryKey && claim.existingGroupKey) {
      session.config.groupKey = encode(decode(claim.existingGroupKey, 32))
      session.config.enabled = true
      session.limitedRecovery = false
      session.recoverySeedPending = true
    }
    saveSession(session)
    sessionStorage.removeItem(CLAIM_KEY)
    claim = undefined
    return session
  })().finally(() => { linking = undefined })
  return linking
}

/** All chunks load before store writes. Apply the consented setup in one turn, connection LAST. */
export async function prepareRestoreProfiles(): Promise<TvRestoreSession> {
  const session = pendingTvRestore()
  if (!session) throw new Error('Link your TV first.')
  if (session.stage !== 'validated') return session
  const { sync, companion, profiles } = await runtime()
  if (get(profiles.activeProfileLocked)) throw new Error('Unlock your current profile before restoring a household.')
  const household = session.profile?.household ? profiles.normalizeProfileState(session.profile.household) : null
  const apply = session.profile ? await settingsWriter(session.profile) : () => {}
  const { persisted } = await import('svelte-persisted-store')
  const { finishOnboarding } = await import('$lib/settings/onboarding')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('sync_disable').catch(() => {})
  if (get(profiles.activeProfileLocked)) throw new Error('Unlock your current profile before restoring a household.')
  saveSession(session)
  // No awaits between the first setting write and activating the new config: existing debounced
  // profile publishers must see the entire TV setup and its matching connection together.
  apply()
  if (household) {
    // The existing household store has a read-only public projection; persisted returns its live backing store.
    persisted<ProfileState>('izumi-profiles-v1', household).set(household)
  }
  profiles.profileSwitcherOpen.set(true)
  companion.pairedCompanions.update(devices => [...devices.filter(d => d.deviceId !== session.device.deviceId), session.device])
  sync.cloudflareSyncConfig.set(session.config)
  sync.syncProvider.set('cloudflare')
  session.settingsRestored = !!session.profile
  session.stage = 'profile'
  saveSession(session)
  finishOnboarding()
  return session
}

function assertProfile(session: TvRestoreSession, profiles: Awaited<ReturnType<typeof runtime>>['profiles'], profileId: string): void {
  if (get(profiles.activeProfileId) !== profileId || get(profiles.activeProfileLocked) || get(profiles.profileSwitcherOpen)
    || !get(profiles.profiles).some(p => p.id === profileId)) throw new Error('Select and unlock your household profile before restoring.')
  const remote = session.profile?.household?.profiles.find(p => p.id === profileId)
  if (session.profile?.household && !remote) throw new Error('Select a profile from the restored TV household.')
  const current = get(profiles.profiles).find(p => p.id === profileId)
  if (remote?.pin && (current?.pin?.hash !== remote.pin.hash || current?.pin?.salt !== remote.pin.salt)) {
    throw new Error('The profile protection changed. Restore the TV household and unlock it before importing.')
  }
}

async function settingsWriter(profile: CloudflareResolverProfile): Promise<() => void> {
  const [sources, ui, catalog, collections, cloudflare] = await Promise.all([
    import('$lib/stremio/sources'), import('$lib/settings/ui'), import('$lib/settings/catalog'),
    import('$lib/catalog/collections/store'), import('$lib/sync/cloudflare'),
  ])
  const addons = [...new Set(profile.addons.map(sources.normalizeBase))]
  if (addons.some(url => !url)) throw new Error('A restored source address is invalid. Keep your settings or correct the setup on the TV.')
  const quality = profile.quality === '1440' ? '1080' : profile.quality === '360' ? '480' : profile.quality
  const audio = /^(?:en|eng|english)$/i.test(profile.audioLang) ? 'eng'
    // Japanese is what the anime catalog plays by default, so it restores as Automatic rather than
    // forcing Japanese audio on every catalog.
    : /^(?:ja|jpn|japanese)$/i.test(profile.audioLang) ? 'auto' : get(ui.preferredAudioLang)
  const catalogPlan = profile.catalog ? (() => {
    const saved = profile.catalog!
    const knownDefault = catalog.CATALOG_SELECTIONS.find(provider => provider === saved.defaultScreen)
    const providers = catalog.normalizeCatalogProviders(saved.screens, knownDefault ?? 'auto')
    // A known TV default remains usable even if an older profile omitted it from its screens.
    if (knownDefault && !providers.includes(knownDefault)) providers.push(knownDefault)
    const screen = catalog.resolveCatalogScreenStartup(saved.defaultScreen, saved.defaultScreen, providers)
    return { providers, screen }
  })() : null
  return () => {
    // Save the largest/explicitly fallible value first, before notifying the settings watchers.
    if (profile.collections) collections.homeCollections.set(profile.collections)
    sources.addonUrls.set(addons); sources.disabledSources.set([])
    ui.debridProvider.set(profile.debrid?.provider ?? ''); ui.debridKey.set(profile.debrid?.credential ?? '')
    ui.preferredQuality.set(quality); ui.preferredAudioLang.set(audio); ui.preferredStreamSort.set(profile.sort)
    cloudflare.cloudflareAllowLanSources.set(profile.allowPrivateNetworkSources === true)
    if (profile.catalog && catalogPlan) {
      catalog.catalogProviders.set(catalogPlan.providers)
      catalog.catalogDefaultProvider.set(catalogPlan.screen)
      catalog.selectCatalogScreen(catalogPlan.screen)
      catalog.tmdbReadToken.set(profile.catalog.tmdbToken)
      ui.showAdult.set(profile.catalog.showAdult); ui.hideSpoilers.set(profile.catalog.hideSpoilers)
    }
  }
}

/** Finish pairing after the existing profile UI has selected/unlocked the destination partition. */
export async function finishTvRestore(): Promise<TvRestoreSession> {
  const session = pendingTvRestore()
  if (!session || session.stage === 'validated') throw new Error('Select your household profile first.')
  const { sync, profiles } = await runtime()
  const profileId = get(profiles.activeProfileId)
  assertProfile(session, profiles, profileId)
  assertRestoreConnection(session, sync)
  if (session.recoverySeedPending) {
    const { saveCloudflareCompanionRecovery } = await import('$lib/sync/cloudflare')
    assertProfile(session, profiles, profileId)
    assertRestoreConnection(session, sync)
    try {
      if (!session.device.cloudflare || await saveCloudflareCompanionRecovery(session.device.cloudflare) !== true) {
        throw new Error('The Worker could not confirm the recovery record.')
      }
    } catch (cause) {
      throw new Error('Your TV link is saved, but encrypted recovery could not be saved or verified. Retry finishing secure recovery.', { cause })
    }
    assertProfile(session, profiles, profileId)
    assertRestoreConnection(session, sync)
  }
  const finished: TvRestoreSession = { ...session, stage: 'linked', recoverySeedPending: false }
  saveSession(finished)
  return finished
}

function assertRestoreConnection(session: TvRestoreSession, sync: Awaited<ReturnType<typeof runtime>>['sync']): void {
  const config = get(sync.cloudflareSyncConfig)
  if ((!config.enabled && !session.limitedRecovery) || get(sync.syncProvider) !== 'cloudflare' || config.deviceId !== session.config.deviceId
    || config.endpoint !== session.config.endpoint || config.deviceToken !== session.config.deviceToken || config.groupKey !== session.config.groupKey) {
    throw new Error('Your sync connection changed. Return to the restored Worker before importing.')
  }
}

async function linkedContext() {
  const session = pendingTvRestore()
  if (!session || session.stage !== 'linked') throw new Error('Finish linking your TV first.')
  const context = await runtime()
  assertRestoreConnection(session, context.sync)
  const profileId = get(context.profiles.activeProfileId)
  assertProfile(session, context.profiles, profileId)
  return { session, profileId, ...context }
}

/** Explicit, retryable import. A failure leaves the successful pairing and journal intact. */
export async function restoreTvProgress(): Promise<void> {
  const { session, profileId, sync, companion, profiles } = await linkedContext()
  if (!session.limitedRecovery) await sync.pullWatchProgress()
  assertProfile(session, profiles, profileId)
  await companion.syncCompanionProgress(session.device)
  assertProfile(session, profiles, profileId)
  session.progressRestored = true
  saveSession(session)
}

/** Only called after the user asks to look for a previously shared settings snapshot. */
export async function listTvRestoreSetups(): Promise<ManualDevice[]> {
  const { session, profileId, sync, profiles } = await linkedContext()
  if (session.limitedRecovery) return []
  const devices = await sync.listManualDevices()
  assertProfile(session, profiles, profileId)
  return devices.filter(device => !device.isThisDevice && (device.profileId ?? 'default') === profileId)
}

export async function restoreTvSetup(device: ManualDevice): Promise<void> {
  const { session, profileId, sync, profiles } = await linkedContext()
  if (session.limitedRecovery || device.isThisDevice || (device.profileId ?? 'default') !== profileId) throw new Error('Choose a setup shared for your active profile.')
  assertProfile(session, profiles, profileId)
  await sync.receiveManualSnapshot(device)
}

export function dismissTvRestore(): void {
  const session = pendingTvRestore()
  if (session && session.stage !== 'linked') throw new Error('Finish linking before closing this restore.')
  localStorage.removeItem(STORAGE_KEY)
  memorySession = null
  setCompanionRestorePending(false)
}
