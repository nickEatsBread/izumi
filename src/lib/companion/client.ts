import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { SamsungSmartViewChannel } from '$lib/player/samsung-smart-view'
import { setTizenReceiverRelayForeground, type TizenReceiverDevice } from '$lib/player/tizen-receiver-cast'
import { isAndroid, isTv } from '$lib/platform'
import {
  catalogScreen,
  catalogLabel,
  catalogProviders,
  catalogScreens,
  selectCatalogScreen,
  type CatalogScreen,
} from '$lib/settings/catalog'
import {
  createCloudflareCompanionPairing,
  publishCompanionSnapshot,
  removeCloudflareCompanionPairing,
  revokeCloudflareCompanionTransport,
  syncProvider,
  type CloudflareCompanionTransport,
} from '$lib/sync/client'
import { getCloudflareResolverProfile, type CloudflareResolverProfile } from '$lib/sync/cloudflare'
import {
  COMPANION_PROTOCOL,
  type CompanionHomeSnapshot,
  type CompanionMedia,
  type CompanionPairingLink,
  type CompanionTransportEndpoint,
} from './protocol'

export interface PairedCompanion {
  deviceId: string
  name: string
  address: string
  credential: string
  pairedAt: number
  cloudflare?: CloudflareCompanionTransport
}

export const pairedCompanions = persisted<PairedCompanion[]>('paired-tizen-companions-v1', [])

export interface PendingCompanionPlayback {
  device: PairedCompanion
  media: CompanionMedia
  requestId?: string
  pairingId?: string
  expiresAt?: number
}

export type CompanionPlayContext = Omit<PendingCompanionPlayback, 'device' | 'media'>
export type CompanionSourceSelection = (requestId: string, choiceId: string, device: PairedCompanion) => void

/** Session-only target: the next selected source must be sent to this TV, not played locally. */
export const pendingCompanionPlayback = writable<PendingCompanionPlayback | null>(null)

export function acceptCompanionPlayRequest(
  media: CompanionMedia,
  device: PairedCompanion,
  remote: Omit<PendingCompanionPlayback, 'device' | 'media'> = {},
): string {
  pendingCompanionPlayback.set({ device, media, ...remote })
  const ref = media.ref
  const base = ref.provider === 'anilist'
    ? ref.type === 'manga' ? `/app/manga/${encodeURIComponent(ref.id)}` : `/app/anime/${encodeURIComponent(ref.id)}`
    : `/app/media/${ref.provider}/${ref.type}/${encodeURIComponent(ref.id)}`
  return `${base}${media.episode ? `?episode=${media.episode}` : ''}`
}

export type DiscoveredCompanion = TizenReceiverDevice & { model?: string }

type SamsungDiscovery = { devices?: DiscoveredCompanion[] }

function companionLabel(value: DiscoveredCompanion): string {
  const name = value.name.replace(/^\[TV\]\s*/i, '').trim() || 'Samsung TV'
  return `${name} · izumi Companion`
}

/** Find TVs where izumi Companion is installed. The native probes do not require it to be open. */
export async function discoverCompanionReceivers(): Promise<DiscoveredCompanion[]> {
  const remembered = get(pairedCompanions).map((device): DiscoveredCompanion => ({
    id: device.deviceId,
    name: device.name,
    address: device.address,
  }))
  let discovered: DiscoveredCompanion[] = []
  try {
    const result = get(isAndroid)
      ? await invoke<SamsungDiscovery>('plugin:extplayer|discover_tizen_receivers')
      : { devices: await invoke<DiscoveredCompanion[]>('companion_discover') }
    discovered = result.devices ?? []
  } catch {
    // Remembered devices remain usable when multicast/subnet discovery is unavailable.
  }
  const candidates = new Map<string, DiscoveredCompanion>()
  for (const device of [...remembered, ...discovered]) {
    if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(device.address)) {
      candidates.set(device.address, device)
    }
  }
  return [...candidates.values()].map((device) => ({
    ...device,
    id: `companion:${device.id}`,
    name: companionLabel(device),
  }))
}

export function normalizeCompanionPairingCode(value: string): string | null {
  const code = value.replace(/[^0-9a-f]/gi, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(code) ? code : null
}

/** Android always provisions the route for mobile wake-ups. Desktop provisions it only after the
 * user explicitly enables Worker source resolving; desktop notification enrollment stays absent. */
export function shouldProvisionCompanionWorkerRoute(input: {
  provider: 'iroh' | 'cloudflare'
  android: boolean
  tv: boolean
  resolverEnabled: boolean
}): boolean {
  return input.provider === 'cloudflare' && !input.tv && (input.android || input.resolverEnabled)
}

interface CompanionWorkerRoutePolicy {
  provision: boolean
  playbackMode: CloudflareCompanionTransport['playbackMode']
  wakeWhenClosed: boolean
}

export function companionWorkerPlaybackPolicy(input: {
  provider: 'iroh' | 'cloudflare'
  android: boolean
  tv: boolean
  profile?: Pick<CloudflareResolverProfile, 'enabled' | 'connectedDeviceFallback'>
}): CompanionWorkerRoutePolicy {
  const resolverEnabled = input.profile?.enabled === true
  return {
    provision: shouldProvisionCompanionWorkerRoute({ ...input, resolverEnabled }),
    playbackMode: resolverEnabled
      ? input.profile?.connectedDeviceFallback ? 'cloud-and-device' : 'cloud-only'
      : 'device-only',
    wakeWhenClosed: input.android,
  }
}

async function companionWorkerRoutePolicy(profileOverride?: CloudflareResolverProfile): Promise<CompanionWorkerRoutePolicy> {
  const provider = get(syncProvider)
  const android = get(isAndroid)
  const tv = get(isTv)
  let profile = profileOverride
  if (provider === 'cloudflare' && !tv && !profile) {
    try { profile = (await getCloudflareResolverProfile()).profile }
    catch { /* Android wake-only pairing and local desktop pairing remain available with an old Worker. */ }
  }
  return companionWorkerPlaybackPolicy({ provider, android, tv, profile })
}

async function pairingChallengeAt(address: string, code: string): Promise<CompanionPairingLink | null> {
  const channel = new SamsungSmartViewChannel(address, { name: 'Izumi pairing code' })
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: CompanionPairingLink | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stopChallenge()
      channel.disconnect()
      resolve(value)
    }
    const stopChallenge = channel.on('izumi.companion.challenge', (value) => {
      const challenge = value as { deviceId?: unknown; challenge?: unknown; expiresAt?: unknown } | null
      if (!challenge
        || typeof challenge.deviceId !== 'string'
        || typeof challenge.challenge !== 'string'
        || typeof challenge.expiresAt !== 'number'
        || !/^[0-9a-f]{24}$/i.test(challenge.deviceId)
        || !/^[0-9a-f]{32}$/i.test(challenge.challenge)
        || challenge.expiresAt <= Date.now()
        || challenge.challenge.slice(0, 6).toUpperCase() !== code) return
      finish({ protocol: COMPANION_PROTOCOL, address, deviceId: challenge.deviceId, challenge: challenge.challenge })
    })
    const timer = setTimeout(() => finish(null), 6_500)
    void channel.connect(4_000)
      .then(() => channel.waitForReceiver(1_500))
      .then((available) => { if (!available) finish(null) })
      .catch(() => finish(null))
  })
}

/** Finds a nearby TV by its short on-screen code; full challenge verification still occurs during pairing. */
export async function resolveCompanionPairingCode(value: string): Promise<CompanionPairingLink> {
  const code = normalizeCompanionPairingCode(value)
  if (!code) throw new Error('Enter the six-character code shown on your TV.')
  const devices = await discoverCompanionReceivers()
  const addresses = [...new Set(devices.map((device) => device.address))]
  if (!addresses.length) throw new Error('No Samsung TV running Izumi Companion was found on this Wi-Fi network.')
  const matches = await Promise.all(addresses.map((address) => pairingChallengeAt(address, code)))
  const match = matches.find((candidate): candidate is CompanionPairingLink => Boolean(candidate))
  if (!match) throw new Error('That code did not match a nearby TV. Check the code and make sure the pairing screen is open.')
  return match
}

type CompanionConnection = {
  device: PairedCompanion
  channel: SamsungSmartViewChannel
  dispose: () => void
}

const connections = new Map<string, CompanionConnection>()
let backgroundSnapshotFactory: (() => Promise<CompanionHomeSnapshot>) | undefined
let backgroundPlayHandler: ((media: CompanionMedia, device: PairedCompanion, context: CompanionPlayContext) => void) | undefined
let backgroundSearchHandler: ((query: string) => Promise<CompanionMedia[]>) | undefined
let backgroundDetailsHandler: ((media: CompanionMedia) => Promise<CompanionMedia>) | undefined
let backgroundSourceSelectionHandler: CompanionSourceSelection | undefined

/** Publish only labels plus opaque request-scoped ids. Resolved URLs and provider credentials never
 * leave the linked device until the TV selects one and the normal cast handoff prepares it. */
export function publishCompanionSourceOptions(
  deviceId: string,
  requestId: string,
  options: { choices: { id: string; label: string; detail?: string }[]; resolving: boolean; error?: string },
): boolean {
  const connection = connections.get(deviceId)
  if (!connection?.channel.connected || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return false
  connection.channel.publish('izumi.companion.source-options', {
    credential: connection.device.credential,
    requestId,
    choices: options.choices.slice(0, 40),
    resolving: options.resolving,
    error: options.error,
  }, 'host')
  return true
}

function randomCredential(): string {
  const value = new Uint8Array(32)
  crypto.getRandomValues(value)
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function upsertCompanion(value: PairedCompanion): void {
  pairedCompanions.update((items) => [value, ...items.filter((item) => item.deviceId !== value.deviceId)].slice(0, 16))
}

/** Remove local reconnection state and revoke the TV-only route in its original private Worker. */
export async function forgetCompanion(deviceId: string): Promise<void> {
  const device = get(pairedCompanions).find((candidate) => candidate.deviceId === deviceId)
  if (!device) return
  const connection = connections.get(deviceId)
  if (connection?.channel.connected) {
    try {
      connection.channel.publish('izumi.companion.unpair', { credential: device.credential }, 'host')
      await new Promise((resolve) => setTimeout(resolve, 75))
    } catch { /* The local capability is still removed below. */ }
  }
  connection?.dispose()
  pairedCompanions.update((items) => items.filter((item) => item.deviceId !== deviceId))
  if (!device.cloudflare) return
  try {
    await revokeCloudflareCompanionTransport(device.cloudflare)
  } catch {
    throw new Error('The TV was forgotten here, but its private Worker was unreachable. Its capability may remain until you redeploy or delete the Worker data.')
  }
}

async function bridge(snapshot: CompanionHomeSnapshot): Promise<CompanionTransportEndpoint> {
  return invoke<CompanionTransportEndpoint>('companion_publish_snapshot', { snapshot: JSON.stringify(snapshot) })
}

function waitForPairResult(channel: SamsungSmartViewChannel, deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('The TV did not confirm pairing. Refresh its QR code and try again.'))
    }, 8_000)
    const off = channel.on('izumi.companion.paired', (value) => {
      const result = value as { ok?: unknown; deviceId?: unknown; error?: unknown } | null
      // A different receiver sharing the Samsung channel must never be allowed to reject or
      // confirm this pairing attempt. Only the challenged TV may settle it.
      if (!result || result.deviceId !== deviceId) return
      clearTimeout(timer)
      off()
      if (result.ok === true) resolve()
      else reject(new Error(typeof result.error === 'string' ? result.error : 'The TV rejected pairing.'))
    })
  })
}

/** Pair only after the QR challenge has been observed from the same TV channel. */
export async function pairCompanion(
  link: CompanionPairingLink,
  snapshot: CompanionHomeSnapshot,
  groupName: string,
): Promise<PairedCompanion> {
  const channel = new SamsungSmartViewChannel(link.address, { name: 'Izumi pairing' })
  let cloudflare: CloudflareCompanionTransport | undefined
  let challengeMatched = false
  let challengeTimer: ReturnType<typeof setTimeout> | undefined
  let stopChallenge: () => void = () => {}
  const challenge = new Promise<void>((resolve, reject) => {
    challengeTimer = setTimeout(() => reject(new Error('The TV pairing code could not be verified.')), 5_000)
    stopChallenge = channel.on('izumi.companion.challenge', (value) => {
      const message = value as { challenge?: unknown; deviceId?: unknown; expiresAt?: unknown } | null
      if (!message || message.challenge !== link.challenge || message.deviceId !== link.deviceId) return
      if (typeof message.expiresAt !== 'number' || message.expiresAt <= Date.now()) {
        clearTimeout(challengeTimer)
        reject(new Error('That TV pairing code has expired. Refresh it and scan again.'))
        return
      }
      challengeMatched = true
      clearTimeout(challengeTimer)
      resolve()
    })
  })
  try {
    await channel.connect(4_000)
    await challenge
    stopChallenge()
    if (!challengeMatched || !channel.hasReceiver) throw new Error('The code did not come from the selected TV app.')
    const credential = randomCredential()
    const endpoint = await bridge(snapshot)
    await publishCompanionSnapshot(snapshot)
    const workerPolicy = await companionWorkerRoutePolicy()
    cloudflare = workerPolicy.provision
      ? await createCloudflareCompanionPairing(workerPolicy)
      : undefined
    const paired = waitForPairResult(channel, link.deviceId)
    channel.publish('izumi.companion.pair', {
      protocol: COMPANION_PROTOCOL,
      challenge: link.challenge,
      credential,
      groupName: groupName.trim() || 'Izumi sync group',
      transport: { bridge: endpoint, cloudflare },
      snapshot,
    }, 'host')
    await paired
    const device: PairedCompanion = {
      deviceId: link.deviceId,
      name: 'Samsung TV',
      address: link.address,
      credential,
      pairedAt: Date.now(),
      cloudflare,
    }
    upsertCompanion(device)
    keepConnection(device, channel, snapshot, backgroundSnapshotFactory, backgroundPlayHandler, backgroundSearchHandler, backgroundDetailsHandler, backgroundSourceSelectionHandler)
    return device
  } catch (error) {
    clearTimeout(challengeTimer)
    stopChallenge()
    void challenge.catch(() => {})
    channel.disconnect()
    if (cloudflare) void removeCloudflareCompanionPairing(cloudflare.pairingId).catch(() => {})
    throw error
  }
}

function sendSnapshot(connection: CompanionConnection, snapshot: CompanionHomeSnapshot): void {
  if (!connection.channel.connected) return
  connection.channel.publish('izumi.companion.snapshot', {
    credential: connection.device.credential,
    snapshot,
  }, 'host')
}

function sendWorkerTransport(connection: CompanionConnection): void {
  if (!connection.channel.connected || !connection.device.cloudflare) return
  connection.channel.publish('izumi.companion.transport', {
    credential: connection.device.credential,
    cloudflare: connection.device.cloudflare,
  }, 'host')
}

function keepConnection(
  device: PairedCompanion,
  channel: SamsungSmartViewChannel,
  initialSnapshot: CompanionHomeSnapshot,
  createSnapshot?: () => Promise<CompanionHomeSnapshot>,
  onPlay?: (media: CompanionMedia, device: PairedCompanion, context: CompanionPlayContext) => void,
  onSearch?: (query: string) => Promise<CompanionMedia[]>,
  onDetails?: (media: CompanionMedia) => Promise<CompanionMedia>,
  onSourceSelection?: CompanionSourceSelection,
): void {
  connections.get(device.deviceId)?.dispose()
  const activeTrailerRequests = new Set<string>()
  const unsubscribers = [
    channel.on('izumi.companion.refresh', () => {
      if (createSnapshot) {
        void createSnapshot().then(async (snapshot) => {
          await publishCompanionSnapshot(snapshot).catch(() => {})
          sendSnapshot(connection, snapshot)
        })
      } else sendSnapshot(connection, initialSnapshot)
    }),
    channel.on('izumi.companion.play', (value, from) => {
      const request = value as Partial<CompanionMedia> & {
        ref?: CompanionMedia['ref']
        pairingId?: unknown
        requestId?: unknown
        episode?: unknown
        season?: unknown
        resolver?: unknown
      }
      const pairingId = device.cloudflare?.pairingId ?? device.credential.slice(0, 16)
      if (request.pairingId !== pairingId || !request.ref) return
      if (typeof request.requestId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(request.requestId)) {
        channel.publish('izumi.companion.play-accepted', {
          pairingId,
          requestId: request.requestId,
        }, from?.id || 'host')
      }
      const resolver = request.resolver && typeof request.resolver === 'object'
        && ((request.resolver as { streamType?: unknown }).streamType === 'movie'
          || (request.resolver as { streamType?: unknown }).streamType === 'series')
        ? request.resolver as CompanionMedia['resolver']
        : undefined
      const playback = request.playback && typeof request.playback === 'object'
        && (request.playback as { selection?: unknown }).selection === 'manual'
        ? {
            selection: 'manual' as const,
            positionSeconds: typeof (request.playback as { positionSeconds?: unknown }).positionSeconds === 'number'
              && Number.isFinite((request.playback as { positionSeconds: number }).positionSeconds)
              ? Math.max(0, Math.min((request.playback as { positionSeconds: number }).positionSeconds, 604_800))
              : undefined,
          }
        : undefined
      onPlay?.({
        ref: request.ref,
        resolver,
        playback,
        title: '',
        episode: typeof request.episode === 'number' ? request.episode : undefined,
        season: typeof request.season === 'number' ? request.season : undefined,
      }, device, {
        pairingId,
        requestId: typeof request.requestId === 'string' ? request.requestId : undefined,
      })
    }),
    channel.on('izumi.companion.source-select', (value) => {
      const request = value as { pairingId?: unknown; requestId?: unknown; choiceId?: unknown } | null
      const pairingId = device.cloudflare?.pairingId ?? device.credential.slice(0, 16)
      if (!request || request.pairingId !== pairingId
        || typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(request.requestId)
        || typeof request.choiceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(request.choiceId)) return
      onSourceSelection?.(request.requestId, request.choiceId, device)
    }),
    channel.on('izumi.companion.catalog', (value, from) => {
      const request = value as { screen?: unknown; pairingId?: unknown } | null
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.screen !== 'string') return
      const options = catalogScreens(get(catalogProviders))
      const target = request.screen as CatalogScreen
      const replyTarget = from?.id || 'host'
      const reject = (error: string) => channel.publish('izumi.companion.catalog-result', {
        pairingId: device.credential.slice(0, 16),
        screen: request.screen,
        error,
      }, replyTarget)
      if (!options.includes(target)) {
        reject('That catalogue is no longer enabled in izumi.')
        return
      }
      if (!createSnapshot) {
        reject('Open the izumi catalogue screen on this device, then try again.')
        return
      }
      const previous = get(catalogScreen)
      selectCatalogScreen(target)
      void createSnapshot().then(async (snapshot) => {
        await publishCompanionSnapshot(snapshot).catch(() => {})
        for (const activeConnection of connections.values()) sendSnapshot(activeConnection, snapshot)
      }).catch(() => {
        selectCatalogScreen(previous)
        reject(`${catalogLabel(target)} could not load. Check its enabled sources in izumi.`)
      })
    }),
    channel.on('izumi.companion.search', (value, from) => {
      const request = value as { query?: unknown; requestId?: unknown; pairingId?: unknown } | null
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.query !== 'string'
        || typeof request.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(request.requestId)
        || !onSearch) return
      const query = request.query.trim().slice(0, 80)
      const reply = (payload: Record<string, unknown>) => channel.publish('izumi.companion.search-results', {
        credential: device.credential,
        requestId: request.requestId,
        query,
        ...payload,
      }, from?.id || 'host')
      if (!query) return reply({ items: [] })
      void onSearch(query)
        .then((items) => reply({ items: items.slice(0, 40) }))
        .catch((error) => reply({ error: error instanceof Error ? error.message : 'Search unavailable' }))
    }),
    channel.on('izumi.companion.details', (value, from) => {
      const request = value as { media?: unknown; requestId?: unknown; pairingId?: unknown } | null
      const media = request?.media as Partial<CompanionMedia> | undefined
      const ref = media?.ref
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(request.requestId)
        || !media
        || typeof media.title !== 'string'
        || media.title.length > 240
        || !ref
        || typeof ref.provider !== 'string'
        || typeof ref.type !== 'string'
        || typeof ref.id !== 'string'
        || !onDetails) return
      const reply = (payload: Record<string, unknown>) => channel.publish('izumi.companion.details-result', {
        credential: device.credential,
        requestId: request.requestId,
        ...payload,
      }, from?.id || 'host')
      void onDetails(media as CompanionMedia)
        .then((details) => reply({ media: details }))
        .catch((error) => reply({ error: error instanceof Error ? error.message : 'Episode details unavailable' }))
    }),
    channel.on('izumi.companion.trailer', (value, from) => {
      const request = value as { pairingId?: unknown; requestId?: unknown; videoId?: unknown; title?: unknown; muted?: unknown } | null
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(request.requestId)
        || typeof request.videoId !== 'string'
        || !/^[A-Za-z0-9_-]{11}$/.test(request.videoId)) return
      const reply = (payload: Record<string, unknown>) => channel.publish('izumi.companion.trailer-result', {
        credential: device.credential,
        requestId: request.requestId,
        ...payload,
      }, from?.id || 'host')
      void invoke<string>('youtube_embed_lan_url', {
        id: request.videoId,
        controls: false,
        muted: request.muted === true,
      }).then(async (url) => {
        await setTizenReceiverRelayForeground(true, typeof request.title === 'string' ? request.title.slice(0, 160) : 'TV trailer', 'trailer')
        activeTrailerRequests.add(request.requestId as string)
        reply({ url })
      }).catch((error) => reply({
        error: error instanceof Error ? error.message : 'Trailer playback bridge unavailable',
      }))
    }),
    channel.on('izumi.companion.trailer-close', (value) => {
      const request = value as { pairingId?: unknown; requestId?: unknown } | null
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(request.requestId)) return
      if (activeTrailerRequests.delete(request.requestId) && !activeTrailerRequests.size) {
        void setTizenReceiverRelayForeground(false, undefined, 'trailer')
      }
    }),
  ]
  const connection: CompanionConnection = {
    device,
    channel,
    dispose: () => {
      unsubscribers.forEach((off) => off())
      if (activeTrailerRequests.size) void setTizenReceiverRelayForeground(false, undefined, 'trailer')
      channel.disconnect()
      connections.delete(device.deviceId)
    },
  }
  connections.set(device.deviceId, connection)
}

async function reconnect(
  device: PairedCompanion,
  createSnapshot: () => Promise<CompanionHomeSnapshot>,
  onPlay: (media: CompanionMedia, device: PairedCompanion, context: CompanionPlayContext) => void,
  onSearch: (query: string) => Promise<CompanionMedia[]>,
  onDetails: (media: CompanionMedia) => Promise<CompanionMedia>,
  onSourceSelection?: CompanionSourceSelection,
): Promise<void> {
  if (connections.get(device.deviceId)?.channel.connected) return
  const channel = new SamsungSmartViewChannel(device.address, { name: 'Izumi' })
  try {
    await channel.connect(2_500)
    if (!await channel.waitForReceiver()) return channel.disconnect()
    const snapshot = await createSnapshot()
    keepConnection(device, channel, snapshot, createSnapshot, onPlay, onSearch, onDetails, onSourceSelection)
    const connection = connections.get(device.deviceId)!
    sendSnapshot(connection, snapshot)
    sendWorkerTransport(connection)
  } catch {
    channel.disconnect()
  }
}

/** Add private Worker capabilities to TVs paired before source resolving was enabled. The route is
 * stored immediately and delivered over the authenticated local channel whenever each TV is open. */
export async function provisionCompanionResolverRoutes(profileOverride?: CloudflareResolverProfile): Promise<number> {
  if (get(syncProvider) !== 'cloudflare' || get(isTv)) return 0
  const policy = await companionWorkerRoutePolicy(profileOverride)
  let provisioned = 0
  for (const device of get(pairedCompanions)) {
    const cloudflare = device.cloudflare
      ? { ...device.cloudflare, playbackMode: policy.playbackMode, wakeWhenClosed: policy.wakeWhenClosed }
      : policy.provision ? await createCloudflareCompanionPairing(policy) : undefined
    if (!cloudflare) continue
    if (!device.cloudflare) provisioned += 1
    const updated = { ...device, cloudflare }
    upsertCompanion(updated)
    const connection = connections.get(device.deviceId)
    if (connection) {
      connection.device = updated
      sendWorkerTransport(connection)
    } else if (backgroundSnapshotFactory && backgroundPlayHandler && backgroundSearchHandler && backgroundDetailsHandler) {
      void reconnect(updated, backgroundSnapshotFactory, backgroundPlayHandler, backgroundSearchHandler, backgroundDetailsHandler, backgroundSourceSelectionHandler)
    }
  }
  return provisioned
}

/** Maintains lightweight channels only for TVs the user explicitly paired. */
export function initCompanionConnections(
  createSnapshot: () => Promise<CompanionHomeSnapshot>,
  onPlay: (media: CompanionMedia, device: PairedCompanion, context: CompanionPlayContext) => void,
  onSearch: (query: string) => Promise<CompanionMedia[]>,
  onDetails: (media: CompanionMedia) => Promise<CompanionMedia>,
  onSourceSelection?: CompanionSourceSelection,
): () => void {
  backgroundSnapshotFactory = createSnapshot
  backgroundPlayHandler = onPlay
  backgroundSearchHandler = onSearch
  backgroundDetailsHandler = onDetails
  backgroundSourceSelectionHandler = onSourceSelection
  let stopped = false
  const refresh = () => {
    if (stopped) return
    for (const device of get(pairedCompanions)) void reconnect(device, createSnapshot, onPlay, onSearch, onDetails, onSourceSelection)
  }
  refresh()
  const timer = setInterval(refresh, 30_000)
  return () => {
    stopped = true
    if (backgroundSnapshotFactory === createSnapshot) backgroundSnapshotFactory = undefined
    if (backgroundPlayHandler === onPlay) backgroundPlayHandler = undefined
    if (backgroundSearchHandler === onSearch) backgroundSearchHandler = undefined
    if (backgroundDetailsHandler === onDetails) backgroundDetailsHandler = undefined
    if (backgroundSourceSelectionHandler === onSourceSelection) backgroundSourceSelectionHandler = undefined
    clearInterval(timer)
    for (const connection of connections.values()) connection.dispose()
  }
}
