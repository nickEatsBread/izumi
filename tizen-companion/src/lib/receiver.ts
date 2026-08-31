import type {
  CastControlRequest,
  CastLoadRequest,
  CompanionHomeSnapshot,
  CompanionCloudflareTransport,
  CompanionMedia,
  PairingInfo,
  PlaybackSnapshot,
  PlaybackSourceChoice,
} from '../types'
import { isCompanionSnapshot } from '../types'
import { cloudResolveRequest, cloudResolveSelection } from './cloud-resolver'

const CHANNEL_ID = 'com.nicho.izumi.cast'
const PAIRING_LIFETIME_MS = 5 * 60_000
const LOCAL_PLAY_ACK_MS = 1_200
const REMOTE_REQUEST_TTL_MS = 5 * 60_000
const SNAPSHOT_STORAGE_KEY = 'izumi.companion.snapshot'

export type CompanionPlayResult =
  | 'local'
  | 'notified'
  | 'queued'
  | 'open-client'
  | 'worker-error'
  | 'no-source'
  | { kind: 'resolved'; request: CastLoadRequest; sources: PlaybackSourceChoice[]; selectedId: string }

export interface ReceiverEvents {
  onConnection(connected: boolean): void
  onPaired(paired: boolean): void
  onPairingInfo(info: PairingInfo): void
  onSnapshot(snapshot: CompanionHomeSnapshot): void
  onSearchResults(query: string, items: CompanionMedia[], error?: string): void
  onLoad(request: CastLoadRequest, senderId: string): void
  onControl(request: CastControlRequest, senderId: string): void
  onDeviceSourceAvailability?(available: boolean): void
}

function parseMessage(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}

function peerId(from: unknown): string {
  if (typeof from === 'string') return from
  if (from && typeof from === 'object' && 'id' in from) return String(from.id || '')
  return ''
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes)
  try { crypto.getRandomValues(values) } catch {
    for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}

function secureRandomHex(bytes: number): string | null {
  try {
    const values = crypto.getRandomValues(new Uint8Array(bytes))
    return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function credentialBytes(value: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(32)
  for (let index = 0; index < result.length; index += 1) result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return result
}

function parseCloudflareTransport(value: unknown): CompanionCloudflareTransport | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.protocol !== 1
    || typeof input.endpoint !== 'string'
    || typeof input.pairingId !== 'string'
    || typeof input.tvToken !== 'string'
    || !/^[A-Za-z0-9_-]{16,80}$/.test(input.pairingId)
    || !/^[A-Za-z0-9_-]{32,128}$/.test(input.tvToken)) return null
  try {
    const endpoint = new URL(input.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== '/' && endpoint.pathname !== '') return null
    const playbackMode = input.playbackMode === 'cloud-only' || input.playbackMode === 'cloud-and-device'
      ? input.playbackMode
      : 'device-only'
    return {
      protocol: 1,
      endpoint: endpoint.toString().replace(/\/$/, ''),
      pairingId: input.pairingId,
      tvToken: input.tvToken,
      playbackMode,
      // Older routes did not identify whether they came from Android or desktop. Defaulting to no
      // wake avoids queuing a closed desktop request; an open Android app upgrades the policy.
      wakeWhenClosed: input.wakeWhenClosed === true,
    }
  } catch { return null }
}

function storedCloudflareTransport(): CompanionCloudflareTransport | null {
  try { return parseCloudflareTransport(JSON.parse(localStorage.getItem('izumi.companion.cloudflare') || 'null')) } catch { return null }
}

function storedSnapshot(): CompanionHomeSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || 'null')
    return isCompanionSnapshot(value) ? value : null
  } catch { return null }
}

function storeSnapshot(snapshot: CompanionHomeSnapshot): void {
  try { localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot)) } catch { /* TV storage is best-effort. */ }
}

class WorkerRequestError extends Error {
  constructor(message: string, readonly code = '') {
    super(message)
  }
}

function workerRequest(
  transport: CompanionCloudflareTransport,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  payload?: unknown,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(method, `${transport.endpoint}${path}`, true)
    request.timeout = timeoutMs
    request.setRequestHeader('Authorization', `Bearer ${transport.tvToken}`)
    if (payload !== undefined) request.setRequestHeader('Content-Type', 'application/json')
    request.onload = () => {
      let value: Record<string, unknown> = {}
      try { value = JSON.parse(request.responseText || '{}') as Record<string, unknown> } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300) resolve(value)
      else reject(new WorkerRequestError(
        typeof value.error === 'string' ? value.error : `Worker returned ${request.status}.`,
        typeof value.code === 'string' ? value.code : '',
      ))
    }
    request.onerror = () => reject(new Error('The private Worker could not be reached.'))
    request.ontimeout = () => reject(new Error('The private Worker did not respond in time.'))
    request.send(payload === undefined ? null : JSON.stringify(payload))
  })
}

async function encryptedPlayRequest(
  credential: string,
  pairingId: string,
  requestId: string,
  media: CompanionMedia,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const issuedAt = Date.now()
  const plain = new TextEncoder().encode(JSON.stringify({
    v: 1,
    pairingId,
    requestId,
    ref: media.ref,
    episode: media.episode,
    season: media.season,
    resolver: media.resolver,
    playback: media.playback,
    issuedAt,
    expiresAt: issuedAt + REMOTE_REQUEST_TTL_MS,
  }))
  const key = await crypto.subtle.importKey('raw', credentialBytes(credential), { name: 'AES-GCM' }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`izumi-companion:${pairingId}:${requestId}`),
  }, key, plain)
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) })
}

function validUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8192 && /^https?:\/\//i.test(value)
}

function validSearchMedia(value: unknown): value is CompanionMedia {
  if (!value || typeof value !== 'object') return false
  const media = value as Partial<CompanionMedia>
  return typeof media.title === 'string'
    && media.title.length > 0
    && media.title.length <= 240
    && Boolean(media.ref)
    && typeof media.ref?.provider === 'string'
    && typeof media.ref?.type === 'string'
    && typeof media.ref?.id === 'string'
}

function normalizeLoad(value: unknown): CastLoadRequest | undefined {
  const message = parseMessage(value)
  if (!message || typeof message !== 'object') return undefined
  const input = message as Record<string, unknown>
  if (!validUrl(input.url) || typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 128) return undefined
  const rawTracks = Array.isArray(input.subtitles) ? input.subtitles : []
  const subtitles = rawTracks.slice(0, 8).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const track = entry as Record<string, unknown>
    if (!validUrl(track.url)) return []
    return [{
      id: Number.isFinite(Number(track.id)) ? Number(track.id) : index + 1,
      url: track.url,
      title: typeof track.title === 'string' ? track.title.slice(0, 160) : undefined,
      lang: typeof track.lang === 'string' ? track.lang.slice(0, 24) : undefined,
      contentType: typeof track.contentType === 'string' ? track.contentType.slice(0, 80) : undefined,
    }]
  })
  const rawAdaptive = input.adaptive && typeof input.adaptive === 'object' ? input.adaptive as Record<string, unknown> : undefined
  const rawDrm = input.drm && typeof input.drm === 'object' ? input.drm as Record<string, unknown> : undefined
  const drmSystem = rawDrm?.system === 'playready' || rawDrm?.system === 'widevine' ? rawDrm.system : undefined
  const drmLicense = rawDrm && validUrl(rawDrm.licenseServer) ? rawDrm.licenseServer : undefined
  return {
    sessionId: input.sessionId,
    url: input.url,
    title: typeof input.title === 'string' && input.title ? input.title.slice(0, 240) : 'Izumi',
    contentRating: typeof input.contentRating === 'string' ? input.contentRating.slice(0, 32) : undefined,
    contentType: typeof input.contentType === 'string' ? input.contentType.slice(0, 120) : undefined,
    positionSeconds: Math.max(0, Math.min(Number(input.positionSeconds) || 0, 604_800)),
    subtitles,
    activeTrackIds: Array.isArray(input.activeTrackIds)
      ? input.activeTrackIds.slice(0, 1).map(Number).filter(Number.isFinite)
      : [],
    subtitleStyle: input.subtitleStyle && typeof input.subtitleStyle === 'object' ? input.subtitleStyle : undefined,
    adaptive: rawAdaptive ? {
      minBitrateKbps: Number.isFinite(Number(rawAdaptive.minBitrateKbps)) ? Math.max(0, Number(rawAdaptive.minBitrateKbps)) : undefined,
      maxBitrateKbps: Number.isFinite(Number(rawAdaptive.maxBitrateKbps)) ? Math.max(0, Number(rawAdaptive.maxBitrateKbps)) : undefined,
      startBitrate: ['LOWEST', 'AVERAGE', 'HIGHEST'].includes(String(rawAdaptive.startBitrate))
        ? rawAdaptive.startBitrate as 'LOWEST' | 'AVERAGE' | 'HIGHEST'
        : Number.isFinite(Number(rawAdaptive.startBitrate)) ? Math.max(0, Number(rawAdaptive.startBitrate)) : undefined,
    } : undefined,
    drm: drmSystem && drmLicense ? {
      system: drmSystem,
      licenseServer: drmLicense,
      headers: rawDrm?.headers && typeof rawDrm.headers === 'object' ? rawDrm.headers as Record<string, string> : undefined,
      customData: typeof rawDrm?.customData === 'string' ? rawDrm.customData.slice(0, 4096) : undefined,
      deleteLicenseAfterUse: rawDrm?.deleteLicenseAfterUse === true,
    } : undefined,
    cookies: typeof input.cookies === 'string' ? input.cookies.slice(0, 4096) : undefined,
    userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 512) : undefined,
  }
}

function normalizeControl(value: unknown): CastControlRequest | undefined {
  const message = parseMessage(value)
  if (!message || typeof message !== 'object') return undefined
  const input = message as Partial<CastControlRequest>
  const actions: CastControlRequest['action'][] = ['status', 'play', 'pause', 'seek', 'tracks', 'volume', 'stop']
  if (typeof input.sessionId !== 'string' || !actions.includes(input.action as CastControlRequest['action'])) return undefined
  return input as CastControlRequest
}

function privateAddress(): string {
  try {
    const value = window.webapis?.network?.getIp()
    if (value) return value
  } catch { /* Browser preview or unsupported network API. */ }
  return location.hostname || '127.0.0.1'
}

export class CompanionReceiver {
  private channel?: SamsungSmartViewChannel
  private connected = false
  private credential = localStorage.getItem('izumi.companion.credential') ?? ''
  private cloudflare = storedCloudflareTransport()
  private activeSenderId = ''
  private activeSessionId = ''
  private pairing = this.createPairingInfo()
  private pairingTimer?: number
  private playAcknowledgements = new Map<string, (accepted: boolean) => void>()

  constructor(private readonly events: ReceiverEvents) {
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(Boolean(this.credential))
    this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
    const snapshot = this.credential ? storedSnapshot() : null
    if (snapshot) this.events.onSnapshot(snapshot)
  }

  get pairingInfo(): PairingInfo {
    return this.pairing
  }

  async connect(): Promise<boolean> {
    if (!window.msf?.local) return false
    const service = await new Promise<SamsungSmartViewService>((resolve, reject) => {
      window.msf!.local((error, value) => error || !value ? reject(error || new Error('Smart View is unavailable')) : resolve(value))
    })
    this.channel = service.channel(CHANNEL_ID)
    this.channel.on('izumi.load', (value, from) => {
      const request = normalizeLoad(value)
      const sender = peerId(from)
      if (!request || !sender) return
      this.activeSenderId = sender
      this.activeSessionId = request.sessionId
      this.events.onLoad(request, sender)
    })
    this.channel.on('izumi.control', (value, from) => {
      const request = normalizeControl(value)
      const sender = peerId(from)
      if (!request || sender !== this.activeSenderId || request.sessionId !== this.activeSessionId) return
      this.events.onControl(request, sender)
    })
    this.channel.on('izumi.companion.pair', (value, from) => this.receivePair(value, peerId(from)))
    this.channel.on('izumi.companion.transport', (value, from) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      const transport = parseCloudflareTransport(input.cloudflare)
      if (!this.credential || input.credential !== this.credential || !transport) return
      this.cloudflare = transport
      localStorage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
      this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
      this.publish('izumi.companion.transport-ready', {
        pairingId: transport.pairingId,
      }, peerId(from) || 'host')
    })
    this.channel.on('izumi.companion.snapshot', (value) => this.receiveSnapshot(value))
    this.channel.on('izumi.companion.search-results', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential || typeof input.query !== 'string') return
      const items = Array.isArray(input.items) ? input.items.slice(0, 40).filter(validSearchMedia) : []
      this.events.onSearchResults(input.query.slice(0, 80), items, typeof input.error === 'string' ? input.error.slice(0, 240) : undefined)
    })
    this.channel.on('izumi.companion.unpair', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      if ((message as Record<string, unknown>).credential === this.credential) this.unpair(false)
    })
    this.channel.on('izumi.companion.play-accepted', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (input.pairingId !== (this.cloudflare?.pairingId ?? this.credential.slice(0, 16)) || typeof input.requestId !== 'string') return
      this.playAcknowledgements.get(input.requestId)?.(true)
    })
    this.channel.on('clientConnect', (_value, from) => {
      const target = peerId(from) || peerId(_value)
      this.publish('izumi.ready', { protocol: 1, subtitles: ['vtt', 'srt', 'ass', 'ssa'] }, target)
      this.sendChallenge(target)
    })
    await new Promise<void>((resolve, reject) => {
      this.channel!.connect({ name: 'Izumi Companion' }, (error) => error ? reject(error) : resolve())
    })
    this.connected = true
    this.events.onConnection(true)
    this.sendChallenge('broadcast')
    this.pairingTimer = window.setInterval(() => this.sendChallenge('broadcast'), 10_000)
    return true
  }

  requestRefresh(): void {
    this.publish('izumi.companion.refresh', { protocol: 1 }, 'broadcast')
  }

  async requestPlay(media: CompanionMedia): Promise<CompanionPlayResult> {
    if (!this.credential) return 'open-client'
    const secureRequestId = secureRandomHex(16)
    const requestId = secureRequestId ?? randomHex(16)
    const pairingId = this.cloudflare?.pairingId ?? this.credential.slice(0, 16)
    const playbackMode = this.cloudflare?.playbackMode ?? 'device-only'

    if (this.cloudflare && playbackMode !== 'device-only') {
      try {
        const result = await workerRequest(
          this.cloudflare,
          `/v1/companion/pairings/${encodeURIComponent(pairingId)}/resolve`,
          'POST',
          cloudResolveRequest(media),
          30_000,
        )
        const selection = cloudResolveSelection(result, media, requestId)
        if (selection) return { kind: 'resolved', ...selection }
        // A successful Worker response is authoritative. Cloudflare-only never wakes or contacts a
        // linked device; combined mode does so only when the saved profile explicitly requests it.
        if (result.fallback !== 'paired-device') return 'no-source'
      } catch (error) {
        const resolverWasRemoved = error instanceof WorkerRequestError && error.code === 'RESOLVER_NOT_CONFIGURED'
        if (playbackMode === 'cloud-only' && !resolverWasRemoved) return 'worker-error'
        // Combined mode is also an availability fallback: continue through the linked device when
        // the user's Worker is temporarily unavailable.
      }
    }

    return this.requestFromDevice(media, requestId, secureRequestId)
  }

  canRequestDeviceSourceChange(): boolean {
    return Boolean(this.credential) && (this.cloudflare?.playbackMode ?? 'device-only') !== 'cloud-only'
  }

  /** Ask the linked client for an explicit replacement while the current TV source keeps playing. */
  requestDeviceSourceChange(media: CompanionMedia, positionSeconds: number): Promise<CompanionPlayResult> {
    if (!this.canRequestDeviceSourceChange()) return Promise.resolve('no-source')
    const secureRequestId = secureRandomHex(16)
    const requestId = secureRequestId ?? randomHex(16)
    return this.requestFromDevice({
      ...media,
      playback: {
        selection: 'manual',
        positionSeconds: Math.max(0, Math.min(Number(positionSeconds) || 0, 604_800)),
      },
    }, requestId, secureRequestId)
  }

  private async requestFromDevice(
    media: CompanionMedia,
    requestId: string,
    secureRequestId: string | null,
  ): Promise<CompanionPlayResult> {
    const pairingId = this.cloudflare?.pairingId ?? this.credential.slice(0, 16)
    const accepted = new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        window.clearTimeout(timer)
        this.playAcknowledgements.delete(requestId)
        resolve(value)
      }
      const timer = window.setTimeout(() => finish(false), LOCAL_PLAY_ACK_MS)
      this.playAcknowledgements.set(requestId, finish)
    })
    this.publish('izumi.companion.play', {
      ref: media.ref,
      episode: media.episode,
      season: media.season,
      resolver: media.resolver,
      playback: media.playback,
      pairingId,
      requestId,
    }, 'broadcast')
    if (await accepted) return 'local'
    if (!this.cloudflare) return 'open-client'
    if (!this.cloudflare.wakeWhenClosed) return 'open-client'
    if (!secureRequestId || !crypto.subtle) return 'open-client'
    try {
      const payload = await encryptedPlayRequest(this.credential, pairingId, requestId, media)
      const result = await workerRequest(
        this.cloudflare,
        `/v1/companion/pairings/${encodeURIComponent(pairingId)}/requests/${encodeURIComponent(requestId)}`,
        'POST',
        { requestId, payload },
      )
      return Number(result.notified || 0) > 0 ? 'notified' : 'queued'
    } catch {
      return 'worker-error'
    }
  }

  requestCatalog(screen: string): boolean {
    if (!this.credential || !screen || screen.length > 40) return false
    this.publish('izumi.companion.catalog', {
      screen,
      pairingId: this.credential.slice(0, 16),
    }, 'broadcast')
    return true
  }

  requestSearch(query: string): boolean {
    const normalized = query.trim().slice(0, 80)
    if (!this.credential || !normalized) return false
    this.publish('izumi.companion.search', {
      query: normalized,
      requestId: randomHex(12),
      pairingId: this.credential.slice(0, 16),
    }, 'broadcast')
    return true
  }

  publishStatus(snapshot: PlaybackSnapshot): void {
    if (!this.activeSenderId || snapshot.sessionId !== this.activeSessionId) return
    this.publish('izumi.status', snapshot, this.activeSenderId)
  }

  clearPlayback(): void {
    this.activeSenderId = ''
    this.activeSessionId = ''
  }

  unpair(revokeWorker = true): void {
    if (revokeWorker) void this.revokeCloudflarePairing()
    localStorage.removeItem('izumi.companion.credential')
    localStorage.removeItem('izumi.companion.cloudflare')
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY)
    this.credential = ''
    this.cloudflare = null
    this.clearPlayback()
    this.pairing = this.createPairingInfo()
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(false)
    this.events.onDeviceSourceAvailability?.(false)
    this.publish('izumi.companion.unpaired', { deviceId: this.pairing.deviceId }, 'broadcast')
    this.sendChallenge('broadcast')
  }

  resetClient(): void {
    void this.revokeCloudflarePairing()
    Object.keys(localStorage)
      .filter((key) => key.startsWith('izumi.companion.'))
      .forEach((key) => localStorage.removeItem(key))
    this.credential = ''
    this.cloudflare = null
    this.clearPlayback()
    this.pairing = this.createPairingInfo()
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(false)
    this.events.onDeviceSourceAvailability?.(false)
    this.sendChallenge('broadcast')
  }

  disconnect(): void {
    if (this.pairingTimer) window.clearInterval(this.pairingTimer)
    try { this.channel?.disconnect() } catch { /* disconnected already */ }
    this.channel = undefined
    this.connected = false
    this.events.onConnection(false)
  }

  private createPairingInfo(): PairingInfo {
    const stored = localStorage.getItem('izumi.companion.device')
    const deviceId = stored && /^[0-9a-f]{24}$/i.test(stored) ? stored : randomHex(12)
    localStorage.setItem('izumi.companion.device', deviceId)
    const challenge = randomHex(16)
    const expiresAt = Date.now() + PAIRING_LIFETIME_MS
    const address = privateAddress()
    const query = new URLSearchParams({ v: '1', tv: address, device: deviceId, challenge })
    return { deviceId, challenge, expiresAt, address, link: `izumi://companion/pair?${query}` }
  }

  private sendChallenge(target: string): void {
    if (Date.now() >= this.pairing.expiresAt) {
      this.pairing = this.createPairingInfo()
      this.events.onPairingInfo(this.pairing)
    }
    this.publish('izumi.companion.challenge', {
      deviceId: this.pairing.deviceId,
      challenge: this.pairing.challenge,
      expiresAt: this.pairing.expiresAt,
    }, target || 'broadcast')
  }

  private receivePair(value: unknown, senderId: string): void {
    const message = parseMessage(value)
    if (!message || typeof message !== 'object' || !senderId) return
    const input = message as Record<string, unknown>
    const accepted = input.protocol === 1
      && input.challenge === this.pairing.challenge
      && Date.now() < this.pairing.expiresAt
      && typeof input.credential === 'string'
      && /^[0-9a-f]{64}$/i.test(input.credential)
    if (!accepted) {
      this.publish('izumi.companion.paired', { ok: false, deviceId: this.pairing.deviceId, error: 'Pairing challenge rejected.' }, senderId)
      return
    }
    // Re-pairing replaces and revokes the previous private route; a TV never fans out through an
    // old Worker after its owner has linked a different Android device.
    if (this.cloudflare) void this.revokeCloudflarePairing()
    this.credential = String(input.credential)
    localStorage.setItem('izumi.companion.credential', this.credential)
    const transport = input.transport && typeof input.transport === 'object'
      ? parseCloudflareTransport((input.transport as Record<string, unknown>).cloudflare)
      : null
    this.cloudflare = transport
    this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
    if (transport) localStorage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
    else localStorage.removeItem('izumi.companion.cloudflare')
    this.events.onPaired(true)
    const snapshot = input.snapshot
    if (isCompanionSnapshot(snapshot)) {
      storeSnapshot(snapshot)
      this.events.onSnapshot(snapshot)
    } else localStorage.removeItem(SNAPSHOT_STORAGE_KEY)
    this.publish('izumi.companion.paired', { ok: true, deviceId: this.pairing.deviceId }, senderId)
  }

  private receiveSnapshot(value: unknown): void {
    const message = parseMessage(value)
    if (!message || typeof message !== 'object') return
    const input = message as { credential?: unknown; snapshot?: unknown }
    if (!this.credential || input.credential !== this.credential || !isCompanionSnapshot(input.snapshot)) return
    this.events.onPaired(true)
    storeSnapshot(input.snapshot)
    this.events.onSnapshot(input.snapshot)
  }

  private publish(event: string, data: unknown, target: string): void {
    if (!this.channel || !this.connected && event !== 'izumi.ready') return
    try { this.channel.publish(event, data, target || 'broadcast') } catch { /* receiver may be closing */ }
  }

  private async revokeCloudflarePairing(): Promise<void> {
    const transport = this.cloudflare
    if (!transport) return
    try {
      await workerRequest(transport, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}`, 'DELETE')
    } catch { /* Private Worker may be offline; its short-lived requests still expire. */ }
  }
}
