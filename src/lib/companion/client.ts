import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { SamsungSmartViewChannel } from '$lib/player/samsung-smart-view'
import type { TizenReceiverDevice } from '$lib/player/tizen-receiver-cast'
import { isAndroid, isTv } from '$lib/platform'
import {
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
  requestId?: string
  pairingId?: string
  expiresAt?: number
}

/** Session-only target: the next selected source must be sent to this TV, not played locally. */
export const pendingCompanionPlayback = writable<PendingCompanionPlayback | null>(null)

export function acceptCompanionPlayRequest(
  media: CompanionMedia,
  device: PairedCompanion,
  remote: Omit<PendingCompanionPlayback, 'device'> = {},
): string {
  pendingCompanionPlayback.set({ device, ...remote })
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
let backgroundPlayHandler: ((media: CompanionMedia, device: PairedCompanion) => void) | undefined
let backgroundSearchHandler: ((query: string) => Promise<CompanionMedia[]>) | undefined

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
    cloudflare = get(isAndroid) && !get(isTv) && get(syncProvider) === 'cloudflare'
      ? await createCloudflareCompanionPairing()
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
    keepConnection(device, channel, snapshot, backgroundSnapshotFactory, backgroundPlayHandler, backgroundSearchHandler)
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

function keepConnection(
  device: PairedCompanion,
  channel: SamsungSmartViewChannel,
  initialSnapshot: CompanionHomeSnapshot,
  createSnapshot?: () => Promise<CompanionHomeSnapshot>,
  onPlay?: (media: CompanionMedia, device: PairedCompanion) => void,
  onSearch?: (query: string) => Promise<CompanionMedia[]>,
): void {
  connections.get(device.deviceId)?.dispose()
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
      const request = value as Partial<CompanionMedia> & { ref?: CompanionMedia['ref']; pairingId?: unknown; requestId?: unknown; episode?: unknown }
      const pairingId = device.cloudflare?.pairingId ?? device.credential.slice(0, 16)
      if (request.pairingId !== pairingId || !request.ref) return
      if (typeof request.requestId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(request.requestId)) {
        channel.publish('izumi.companion.play-accepted', {
          pairingId,
          requestId: request.requestId,
        }, from?.id || 'host')
      }
      onPlay?.({ ref: request.ref, title: '', episode: typeof request.episode === 'number' ? request.episode : undefined }, device)
    }),
    channel.on('izumi.companion.catalog', (value) => {
      const request = value as { screen?: unknown; pairingId?: unknown } | null
      if (!request
        || request.pairingId !== device.credential.slice(0, 16)
        || typeof request.screen !== 'string') return
      const options = catalogScreens(get(catalogProviders))
      if (!options.includes(request.screen as CatalogScreen)) return
      selectCatalogScreen(request.screen as CatalogScreen)
      if (!createSnapshot) return
      void createSnapshot().then(async (snapshot) => {
        await publishCompanionSnapshot(snapshot).catch(() => {})
        for (const activeConnection of connections.values()) sendSnapshot(activeConnection, snapshot)
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
  ]
  const connection: CompanionConnection = {
    device,
    channel,
    dispose: () => {
      unsubscribers.forEach((off) => off())
      channel.disconnect()
      connections.delete(device.deviceId)
    },
  }
  connections.set(device.deviceId, connection)
}

async function reconnect(
  device: PairedCompanion,
  createSnapshot: () => Promise<CompanionHomeSnapshot>,
  onPlay: (media: CompanionMedia, device: PairedCompanion) => void,
  onSearch: (query: string) => Promise<CompanionMedia[]>,
): Promise<void> {
  if (connections.get(device.deviceId)?.channel.connected) return
  const channel = new SamsungSmartViewChannel(device.address, { name: 'Izumi' })
  try {
    await channel.connect(2_500)
    if (!await channel.waitForReceiver()) return channel.disconnect()
    const snapshot = await createSnapshot()
    keepConnection(device, channel, snapshot, createSnapshot, onPlay, onSearch)
    sendSnapshot(connections.get(device.deviceId)!, snapshot)
  } catch {
    channel.disconnect()
  }
}

/** Maintains lightweight channels only for TVs the user explicitly paired. */
export function initCompanionConnections(
  createSnapshot: () => Promise<CompanionHomeSnapshot>,
  onPlay: (media: CompanionMedia, device: PairedCompanion) => void,
  onSearch: (query: string) => Promise<CompanionMedia[]>,
): () => void {
  backgroundSnapshotFactory = createSnapshot
  backgroundPlayHandler = onPlay
  backgroundSearchHandler = onSearch
  let stopped = false
  const refresh = () => {
    if (stopped) return
    for (const device of get(pairedCompanions)) void reconnect(device, createSnapshot, onPlay, onSearch)
  }
  refresh()
  const timer = setInterval(refresh, 30_000)
  return () => {
    stopped = true
    if (backgroundSnapshotFactory === createSnapshot) backgroundSnapshotFactory = undefined
    if (backgroundPlayHandler === onPlay) backgroundPlayHandler = undefined
    if (backgroundSearchHandler === onSearch) backgroundSearchHandler = undefined
    clearInterval(timer)
    for (const connection of connections.values()) connection.dispose()
  }
}
