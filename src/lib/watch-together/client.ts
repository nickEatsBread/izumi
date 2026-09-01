import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { playerCommand } from '$lib/player/native'
import { nowPlayingMedia, nowPlayingPartySource, playing } from '$lib/player/session'
import { isAndroid } from '$lib/platform'
import { androidMpvActive, seekAbsolute, setPaused } from '$lib/player/android-mpv'
import type { Media } from '$lib/anilist/types'
import { parseSharedSource, sharedSourceKey, streamFromSharedSource, type SharedSource } from './source'
import {
  bestOffsetMs, bufferGateDecision, clockSample, driftDecision, hostPositionNow, pushSample,
  type ClockPing, type ClockPong, type ClockSample, type GateState,
} from './sync'

export type PartyRole = 'host' | 'guest'
export type PartyReadiness = 'waiting' | 'loading' | 'ready' | 'buffering'
export interface WatchPartySession {
  roomCode: string
  role: PartyRole
  joinedAt: number
  /** Device currently allowed to publish authoritative playback. Rotated only by a transfer
   * initiated by the previous authority. */
  hostDeviceId: string
}
export interface PartyParticipant {
  deviceId: string
  name: string
  role: PartyRole
  updatedAt: number
  readiness: PartyReadiness
  paused: boolean
  position: number
  mediaId?: number
  episode?: number
}
interface PartyPlayback {
  media: Media
  episode?: number
  source?: SharedSource
  sourceError?: string
  position: number
  duration: number
  paused: boolean
  /** The host is stalled on its own cache. Guests must not extrapolate through this. */
  buffering?: boolean
  sequence: number
  sentAt: number
}
export interface PartyHostTransfer {
  id: string
  from: string
  to: string
  phase: 'request' | 'commit'
  requestedAt: number
}
export interface PartyTransferAck { id: string; phase: 'accepted' | 'ready' }
export const PARTY_REACTION_EMOJIS = ['❤️', '😂', '😮', '😭', '🔥', '👏', '👍'] as const
export type PartyReactionEmoji = typeof PARTY_REACTION_EMOJIS[number]
export interface PartyReaction {
  id: string
  sender: string
  emoji: PartyReactionEmoji
  mediaId?: number
  episode?: number
  position: number
}
export interface PartyReactionBurst extends PartyReaction {
  name: string
  own: boolean
  receivedAt: number
}
interface PartyWireState {
  deviceId: string
  name: string
  role: PartyRole
  updatedAt: number
  app: 'izumi'
  kind: 'watch-party'
  version: 1
  roomCode: string
  playback?: PartyPlayback
  /** Clock handshake. Guests publish a ping; the host answers on a later heartbeat, keyed by the
   *  guest's deviceId. All three fields are optional and unknown fields are ignored on parse, so a
   *  peer running an older build simply never gets a clock offset and behaves exactly as before. */
  ping?: ClockPing
  pongs?: Record<string, ClockPong>
  /** This peer is stalled on its cache. Drives the host-side buffer gate. */
  buffering?: boolean
  /** Human-readable participant readiness. Optional for compatibility with older room peers. */
  readiness?: PartyReadiness
  paused?: boolean
  position?: number
  mediaId?: number
  episode?: number
  hostTransfer?: PartyHostTransfer
  transferAck?: PartyTransferAck
  reactions?: PartyReaction[]
}

const LIVE_ROOM_MS = 30_000

// Room membership is intentionally ephemeral. It must never restore or attach
// the user to a persistent Device Sync group after restarting Izumi.
export const watchParty = writable<WatchPartySession | null>(null)
export const partyParticipants = writable<PartyParticipant[]>([])
export const partyError = writable('')
export const partySyncing = writable(false)
/** Non-error status for the room (currently the buffer gate). Separate from partyError so a peer
 *  stalling doesn't read as something being broken. */
export const partyNotice = writable('')
export interface PartyHostTransferStatus {
  id: string
  targetDeviceId: string
  targetName: string
  phase: 'requesting' | 'committing' | 'taking-over' | 'reconnecting'
}
export const partyHostTransfer = writable<PartyHostTransferStatus | null>(null)
export const partyReactions = writable<PartyReactionBurst[]>([])
const partyDeviceId = persisted<string>('watch-party-device-id-v1', '')
const partyDisplayName = persisted<string>('watch-party-name-v1', '')

let localClock = { position: 0, duration: 0, paused: false, buffering: false }
let localReadiness: PartyReadiness = 'waiting'
let sequence = 0
let lastPublished = 0
let lastHostPlayback: PartyPlayback | undefined
let applyingRemote = false
let loadingRemote = ''
let remoteRequestedAt = 0
let lastRemotePlayback: PartyPlayback | undefined
let outgoingTransfer: PartyHostTransfer | undefined
let transferAck: PartyTransferAck | undefined
let takeoverTransfer: PartyHostTransfer | undefined
let takeoverTimer: ReturnType<typeof setTimeout> | undefined
let finishingTransfer = false
let reconnecting = false
let localReactions: PartyReaction[] = []
let reactionSends: number[] = []
const seenReactions = new Map<string, number>()

// --- Sync state (reset by leaveWatchParty) ---
/** Guest: round-trip samples and the ping still waiting for an answer. */
let clockSamples: ClockSample[] = []
let pendingPing: ClockPing | null = null
/** Host: the latest unanswered ping per guest, stamped when we read it. */
let inboundPings: Record<string, { id: string; t0: number; t1: number }> = {}
/** Guest: when we last issued a corrective seek, and how many samples have been over threshold. */
let lastRemoteSeekAt = 0
let driftStreak = 0
/** Host: buffer-gate state, plus the pause state the gate itself last applied. */
let gate: GateState = { holdingSince: null }

/** An unanswered ping this old is assumed lost — issue a fresh one rather than waiting forever. */
const PING_TIMEOUT_MS = 6_000

function resetSyncState() {
  clockSamples = []
  pendingPing = null
  inboundPings = {}
  lastRemoteSeekAt = 0
  driftStreak = 0
  gate = { holdingSince: null }
  partyNotice.set('')
  const active = get(playing) || get(androidMpvActive)
  localReadiness = active ? (localClock.duration > 0 ? 'ready' : 'loading') : 'waiting'
}

function resetTransferState() {
  outgoingTransfer = undefined
  transferAck = undefined
  takeoverTransfer = undefined
  finishingTransfer = false
  reconnecting = false
  clearTimeout(takeoverTimer)
  takeoverTimer = undefined
  partyHostTransfer.set(null)
}

function resetReactionState() {
  localReactions = []
  reactionSends = []
  seenReactions.clear()
  partyReactions.set([])
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Generate the six-character code accepted by joinWatchParty. Ambiguous characters are omitted. */
export function generateRoomCode(randomValues?: Uint8Array): string {
  const values = randomValues ?? crypto.getRandomValues(new Uint8Array(6))
  if (values.length < 6) throw new Error('Six random bytes are required for a room code.')
  return Array.from(values.slice(0, 6))
    .map((value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length])
    .join('')
}

function localDeviceId() {
  let id = get(partyDeviceId)
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    partyDeviceId.set(id)
  }
  return id
}

function wireState(session: WatchPartySession, playback?: PartyPlayback): PartyWireState {
  const deviceId = localDeviceId()
  const now = Date.now()
  // A guest keeps exactly one ping in flight; the host answers every ping it has read since its
  // last publish. `t2` is stamped HERE, at publish time, so the delay the host spent sitting on the
  // ping (up to a full heartbeat) is measurable and cancels out of the offset.
  if (session.role === 'guest' && (!pendingPing || now - pendingPing.t0 > PING_TIMEOUT_MS)) {
    pendingPing = { id: Math.random().toString(36).slice(2, 10), t0: now }
  }
  const pongs = session.role === 'host'
    ? Object.fromEntries(Object.entries(inboundPings).map(([id, p]) => [id, { ...p, t2: now }]))
    : undefined
  const activeMedia = get(playing) || get(androidMpvActive) ? get(nowPlayingMedia) : null
  return {
    app: 'izumi', kind: 'watch-party', version: 1,
    roomCode: session.roomCode, role: session.role, deviceId,
    name: get(partyDisplayName) || `${navigator.platform || 'Izumi'} ${deviceId.slice(0, 6)}`,
    updatedAt: now, playback,
    ping: session.role === 'guest' ? pendingPing ?? undefined : undefined,
    pongs: pongs && Object.keys(pongs).length ? pongs : undefined,
    buffering: localClock.buffering || undefined,
    readiness: !activeMedia ? 'waiting' : localClock.buffering ? 'buffering' : localReadiness,
    paused: localClock.paused,
    position: localClock.position,
    mediaId: activeMedia?.media.id,
    episode: activeMedia?.episode,
    hostTransfer: session.role === 'host' ? outgoingTransfer : undefined,
    transferAck: session.role === 'guest' ? transferAck : undefined,
    reactions: localReactions.length ? localReactions : undefined,
  }
}

export function participantFromWire(value: {
  deviceId: string
  name: string
  role: PartyRole
  updatedAt: number
  readiness?: PartyReadiness
  buffering?: boolean
  paused?: boolean
  position?: number
  mediaId?: number
  episode?: number
}): PartyParticipant {
  return {
    deviceId: value.deviceId,
    name: value.name,
    role: value.role,
    updatedAt: value.updatedAt,
    readiness: value.buffering ? 'buffering' : value.readiness ?? (value.mediaId ? 'ready' : 'waiting'),
    paused: !!value.paused,
    position: Number(value.position) || 0,
    mediaId: value.mediaId,
    episode: value.episode,
  }
}

function parse(payload: string): PartyWireState | null {
  try {
    const value = JSON.parse(payload) as PartyWireState
    if (value?.app !== 'izumi' || value.kind !== 'watch-party' || value.version !== 1 || !value.roomCode) return null
    if (value.playback?.source) {
      const source = parseSharedSource(value.playback.source)
      value.playback = source
        ? { ...value.playback, source }
        : { ...value.playback, source: undefined, sourceError: 'The host sent an invalid or credential-bearing source.' }
    }
    if (!validHostTransfer(value.hostTransfer)) value.hostTransfer = undefined
    if (!validTransferAck(value.transferAck)) value.transferAck = undefined
    value.reactions = (value.reactions ?? [])
      .filter((reaction) => validReaction(reaction) && reaction.sender === value.deviceId)
      .slice(-6)
    return value
  } catch { return null }
}

function validHostTransfer(value: PartyHostTransfer | undefined): value is PartyHostTransfer {
  return !!value
    && typeof value.id === 'string' && value.id.length >= 8 && value.id.length <= 80
    && typeof value.from === 'string' && value.from.length > 0 && value.from.length <= 128
    && typeof value.to === 'string' && value.to.length > 0 && value.to.length <= 128
    && (value.phase === 'request' || value.phase === 'commit')
    && Number.isFinite(value.requestedAt)
}

function validTransferAck(value: PartyTransferAck | undefined): value is PartyTransferAck {
  return !!value && typeof value.id === 'string' && value.id.length >= 8 && value.id.length <= 80
    && (value.phase === 'accepted' || value.phase === 'ready')
}

export function validReaction(value: PartyReaction | undefined): value is PartyReaction {
  return !!value
    && typeof value.id === 'string' && value.id.length >= 8 && value.id.length <= 100
    && typeof value.sender === 'string' && value.sender.length > 0 && value.sender.length <= 128
    && PARTY_REACTION_EMOJIS.includes(value.emoji)
    && Number.isFinite(value.position) && value.position >= 0
    && (value.mediaId == null || Number.isFinite(value.mediaId))
    && (value.episode == null || Number.isFinite(value.episode))
}

export function reactionRateError(sentAt: number[], now: number): string {
  const recent = sentAt.filter((time) => now - time < 10_000)
  if (recent.length && now - recent[recent.length - 1] < 350) return 'Reactions are going a little too fast.'
  if (recent.length >= 8) return 'Take a breath before sending more reactions.'
  return ''
}

export function nextHostTransferStep(
  transfer: Pick<PartyHostTransfer, 'id' | 'phase'>,
  ack?: PartyTransferAck,
): 'wait' | 'commit' | 'finalize' {
  if (!ack || ack.id !== transfer.id) return 'wait'
  if (transfer.phase === 'request' && ack.phase === 'accepted') return 'commit'
  if (transfer.phase === 'commit' && ack.phase === 'ready') return 'finalize'
  return 'wait'
}

export function liveRoomHost(records: string[], roomCode: string, now = Date.now(), expectedDeviceId?: string): PartyWireState | null {
  return records
    .map(parse)
    .filter((value): value is PartyWireState => !!value)
    .filter((value) => value.roomCode === roomCode && value.role === 'host' && now - value.updatedAt < LIVE_ROOM_MS)
    .filter((value) => !expectedDeviceId || value.deviceId === expectedDeviceId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

/** Apply one already-decided correction. Seeking is exact so the playhead lands where the ladder
 *  asked; a keyframe seek would leave residual drift that reads back as more drift next sample. */
async function commandRemote(seekTo: number | null, setPausedTo: boolean | null) {
  const android = get(isAndroid) && get(androidMpvActive)
  if (seekTo != null) {
    lastRemoteSeekAt = Date.now()
    if (android) await seekAbsolute(seekTo)
    else await playerCommand('seek', [seekTo.toFixed(3), 'absolute+exact'])
  }
  if (setPausedTo != null) {
    if (android) await setPaused(setPausedTo)
    else await playerCommand('set', ['pause', setPausedTo ? 'yes' : 'no'])
  }
}

/** Host-side pause, used only by the buffer gate. */
async function setLocalPaused(paused: boolean) {
  if (get(isAndroid) && get(androidMpvActive)) await setPaused(paused)
  else await playerCommand('set', ['pause', paused ? 'yes' : 'no'])
}

async function applyHostPlayback(playback: PartyPlayback) {
  const session = get(watchParty)
  if (!session || session.role !== 'guest' || applyingRemote) return
  lastRemotePlayback = playback
  if (!playback.source) throw new Error(playback.sourceError || 'The host source has no shareable address. Ask the host to pick another source.')
  const sourceKey = sharedSourceKey(playback.source)
  const key = `${playback.media.id}:${playback.episode ?? 0}:${sourceKey}`
  const current = get(nowPlayingMedia)
  const localSourceKey = sharedSourceKey(get(nowPlayingPartySource).source)
  if (!current || current.media.id !== playback.media.id || current.episode !== playback.episode || localSourceKey !== sourceKey) {
    if (loadingRemote === key && Date.now() - remoteRequestedAt < 30_000) return
    loadingRemote = key
    remoteRequestedAt = Date.now()
    partySyncing.set(true)
    localReadiness = 'loading'
    try {
      let playbackError = ''
      const { playStream } = await import('$lib/stremio/play')
      await playStream(playback.media, playback.episode, streamFromSharedSource(playback.source), (state) => {
        if (state.status === 'error') {
          playbackError = state.message || 'The host source could not be opened.'
          localReadiness = 'waiting'
        }
      })
      if (playbackError) throw new Error(playbackError)
    } finally {
      partySyncing.set(false)
    }
    return
  }
  loadingRemote = ''
  if (!get(playing) && !get(androidMpvActive)) return
  applyingRemote = true
  try {
    const now = Date.now()
    // Extrapolate on the HOST's clock, not ours. A host that is itself stalled on its cache is
    // frozen for position purposes — extrapolating through its stall would push us ahead and then
    // yank us back the moment it recovers — but it is not *paused*, so the pause command and the
    // (tighter) paused drift threshold still follow `playback.paused` alone.
    const frozen = playback.paused || !!playback.buffering
    const hostPosition = hostPositionNow({ ...playback, paused: frozen }, bestOffsetMs(clockSamples, now), now)
    const decision = driftDecision({
      localPosition: localClock.position,
      localPaused: localClock.paused,
      hostPosition,
      hostPaused: playback.paused,
      now,
      lastSeekAt: lastRemoteSeekAt,
      streak: driftStreak,
    })
    driftStreak = decision.streak
    await commandRemote(decision.seekTo, decision.setPaused)
  } catch (error) {
    partyError.set(error instanceof Error ? error.message : String(error))
  } finally { applyingRemote = false }
}

async function consumeRecords(records: string[], session: WatchPartySession) {
  const now = Date.now()
  const self = localDeviceId()
  const states = records.map(parse).filter((value): value is PartyWireState => !!value)
    .filter((value) => value.roomCode === session.roomCode && now - value.updatedAt < LIVE_ROOM_MS)
  consumeReactionEvents(states, self, now)
  partyParticipants.set(states.map(participantFromWire))
  const peers = states.filter((value) => value.deviceId !== self)
  // Never choose authority by "latest host wins": a guest can publish arbitrary room JSON. The
  // authority is pinned when joining and rotates only through a transfer from that exact device.
  const authority = states
    .filter((value) => value.deviceId === session.hostDeviceId && value.role === 'host')
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  const host = authority?.playback ? authority : undefined

  if (session.role === 'host') {
    // Stamp every guest ping at the moment we read it; wireState pairs it with a publish stamp.
    inboundPings = Object.fromEntries(
      peers.filter((p) => p.ping).map((p) => [p.deviceId, { id: p.ping!.id, t0: p.ping!.t0, t1: now }]),
    )
    await applyBufferGate(peers.some((p) => p.buffering), now)
    await advanceOutgoingTransfer(peers, now)
  } else {
    // Match the host's answer to the ping we still have outstanding. An id we no longer hold is a
    // replayed pong from an earlier exchange and must not produce a sample.
    const pong = host?.pongs?.[self] ?? peers.find((p) => p.role === 'host' && p.pongs?.[self])?.pongs?.[self]
    if (pong && pendingPing && pong.id === pendingPing.id) {
      clockSamples = pushSample(clockSamples, clockSample(pong.t0, pong.t1, pong.t2, now), now)
      pendingPing = null
    }
    partyNotice.set(peers.some((p) => p.role === 'host' && p.buffering) ? 'The host is buffering…' : '')
    acceptIncomingTransfer(authority, session)
  }

  if (host?.playback) await applyHostPlayback(host.playback)
  partyError.set('')
}

function consumeReactionEvents(states: PartyWireState[], self: string, now: number) {
  const current = get(nowPlayingMedia)
  for (const state of states) {
    for (const reaction of state.reactions ?? []) {
      if (seenReactions.has(reaction.id)) continue
      seenReactions.set(reaction.id, now)
      // A reaction belongs to the episode that was on screen when it was sent. Do not surface a
      // delayed event after this device has already moved to a different title or episode.
      if (current && reaction.mediaId != null && (
        current.media.id !== reaction.mediaId || current.episode !== reaction.episode
      )) continue
      showReaction({ ...reaction, name: state.name, own: state.deviceId === self, receivedAt: now })
    }
  }
  if (seenReactions.size > 240) {
    const cutoff = now - 5 * 60_000
    for (const [id, receivedAt] of seenReactions) if (receivedAt < cutoff) seenReactions.delete(id)
  }
}

function showReaction(reaction: PartyReactionBurst) {
  partyReactions.update((items) => [...items.filter((item) => item.id !== reaction.id), reaction].slice(-10))
  setTimeout(() => partyReactions.update((items) => items.filter((item) => item.id !== reaction.id)), 4_200)
}

/** Guest side of the handoff. A request is acknowledged first; only a later commit from the
 * pinned authority arms native takeover. This prevents a stale request from moving the room. */
function acceptIncomingTransfer(authority: PartyWireState | undefined, session: WatchPartySession) {
  const transfer = authority?.hostTransfer
  const self = localDeviceId()
  if (!transfer || transfer.from !== session.hostDeviceId || transfer.to !== self) return
  if (transfer.phase === 'request') {
    transferAck = { id: transfer.id, phase: 'accepted' }
    partyHostTransfer.set({
      id: transfer.id,
      targetDeviceId: self,
      targetName: get(partyDisplayName) || 'This device',
      phase: 'taking-over',
    })
    partyNotice.set('The host is handing room controls to this device…')
    return
  }
  transferAck = { id: transfer.id, phase: 'ready' }
  takeoverTransfer = transfer
  // Everyone who observed the authenticated commit now expects the nominated device. If the old
  // transport disappears before their next exchange, reconnect can reject stale host records.
  watchParty.set({ ...session, hostDeviceId: transfer.to })
  partyNotice.set('Taking over as host…')
  if (!takeoverTimer) {
    // The old host still needs one heartbeat to read our ready acknowledgement and release its
    // endpoint. Connection failure also triggers immediate takeover in refreshWatchParty.
    takeoverTimer = setTimeout(() => { takeoverTimer = undefined; void becomeTransferredHost() }, 2_000)
  }
}

/** Current-host state machine. Publishing commit and waiting for a ready acknowledgement ensures
 * the selected peer has the source/playback capability before the old endpoint is released. */
async function advanceOutgoingTransfer(peers: PartyWireState[], now: number) {
  const transfer = outgoingTransfer
  if (!transfer || finishingTransfer) return
  const target = peers.find((peer) => peer.deviceId === transfer.to)
  if (!target) {
    if (now - transfer.requestedAt > 12_000) {
      outgoingTransfer = undefined
      partyHostTransfer.set(null)
      partyNotice.set('Host transfer cancelled because that participant disconnected.')
    }
    return
  }
  const step = nextHostTransferStep(transfer, target.transferAck)
  if (step === 'commit') {
    outgoingTransfer = { ...transfer, phase: 'commit' }
    partyHostTransfer.update((status) => status ? { ...status, phase: 'committing' } : status)
    partyNotice.set(`Handing room controls to ${target.name}…`)
    return
  }
  if (step === 'finalize') {
    finishingTransfer = true
    queueMicrotask(() => void demoteTransferredHost(transfer, target.name))
  }
}

async function demoteTransferredHost(transfer: PartyHostTransfer, targetName: string) {
  const current = get(watchParty)
  if (!current || current.role !== 'host' || outgoingTransfer?.id !== transfer.id) return
  partyHostTransfer.set({
    id: transfer.id, targetDeviceId: transfer.to, targetName, phase: 'reconnecting',
  })
  partyNotice.set(`${targetName} is taking over. Reconnecting…`)
  try {
    await invoke('watch_room_leave')
    const guest: WatchPartySession = { ...current, role: 'guest', hostDeviceId: transfer.to }
    watchParty.set(guest)
    outgoingTransfer = undefined
    resetSyncState()
    await delay(900)
    await reconnectGuest(guest, 5)
    partyHostTransfer.set(null)
    partyNotice.set(`${targetName} is now the host.`)
  } catch (error) {
    partyError.set(error instanceof Error ? error.message : String(error))
  } finally {
    finishingTransfer = false
  }
}

async function becomeTransferredHost() {
  if (finishingTransfer) return
  const transfer = takeoverTransfer
  const current = get(watchParty)
  const self = localDeviceId()
  if (!transfer || !current || current.role !== 'guest' || transfer.to !== self) return
  finishingTransfer = true
  clearTimeout(takeoverTimer)
  takeoverTimer = undefined
  const host: WatchPartySession = { ...current, role: 'host', hostDeviceId: self }
  const playback = lastRemotePlayback ? {
    ...lastRemotePlayback,
    position: localClock.position,
    duration: localClock.duration || lastRemotePlayback.duration,
    paused: localClock.paused,
    buffering: localClock.buffering,
    sequence: ++sequence,
    sentAt: Date.now(),
  } : undefined
  try {
    const records = await invoke<string[]>('watch_room_host', {
      code: host.roomCode,
      payload: JSON.stringify(wireState(host, playback)),
    })
    watchParty.set(host)
    lastHostPlayback = playback
    takeoverTransfer = undefined
    transferAck = undefined
    resetSyncState()
    partyHostTransfer.set(null)
    partyNotice.set('You are now the host.')
    await consumeRecords(records, host)
  } catch (error) {
    partyError.set(`Could not take over the room yet: ${error instanceof Error ? error.message : String(error)}`)
    finishingTransfer = false
    takeoverTimer = setTimeout(() => { takeoverTimer = undefined; void becomeTransferredHost() }, 1_500)
    return
  }
  finishingTransfer = false
}

async function reconnectGuest(session: WatchPartySession, attempts = 1) {
  if (reconnecting) return
  reconnecting = true
  let lastError: unknown
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const records = await invoke<string[]>('watch_room_join', {
          code: session.roomCode,
          payload: JSON.stringify(wireState(session)),
        })
        const host = liveRoomHost(records, session.roomCode, Date.now(), session.hostDeviceId)
          ?? liveRoomHost(records, session.roomCode)
        if (!host) throw new Error('The new host has not appeared yet.')
        const joined = { ...session, hostDeviceId: host.deviceId }
        watchParty.set(joined)
        await consumeRecords(records, joined)
        partyError.set('')
        return
      } catch (error) {
        lastError = error
        if (attempt + 1 < attempts) await delay(700 + attempt * 350)
      }
    }
    throw lastError
  } finally { reconnecting = false }
}

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)) }

/** Host: hold the room while any peer is still buffering, then let it go again. */
async function applyBufferGate(anyBuffering: boolean, now: number) {
  const decision = bufferGateDecision(gate, { anyBuffering, hostPaused: localClock.paused, now })
  gate = decision.state
  partyNotice.set(decision.notice)
  if (decision.setPaused == null) return
  try {
    await setLocalPaused(decision.setPaused)
    localClock = { ...localClock, paused: decision.setPaused }
  } catch (error) {
    partyError.set(error instanceof Error ? error.message : String(error))
  }
}

async function exchange(playback?: PartyPlayback) {
  const session = get(watchParty)
  if (!session) return
  if (session.role === 'host' && playback) lastHostPlayback = playback
  const state = wireState(session, session.role === 'host' ? lastHostPlayback : undefined)
  const records = await invoke<string[]>('watch_room_exchange', { payload: JSON.stringify(state) })
  await consumeRecords(records, session)
}

export async function refreshWatchParty() {
  if (!get(watchParty)) { partyParticipants.set([]); return true }
  partyError.set('')
  try {
    await exchange()
    return true
  } catch (error) {
    const session = get(watchParty)
    if (session?.role === 'guest') {
      try {
        if (takeoverTransfer?.to === localDeviceId()) await becomeTransferredHost()
        else await reconnectGuest(session, 2)
        return true
      } catch (reconnectError) {
        partyError.set(reconnectError instanceof Error ? reconnectError.message : String(reconnectError))
        return false
      }
    }
    partyError.set(error instanceof Error ? error.message : String(error))
    return false
  }
}

export async function createWatchParty() {
  const self = localDeviceId()
  const session: WatchPartySession = {
    roomCode: generateRoomCode(), role: 'host', joinedAt: Date.now(), hostDeviceId: self,
  }
  lastHostPlayback = undefined
  lastRemotePlayback = undefined
  resetSyncState()
  resetTransferState()
  resetReactionState()
  try {
    const records = await invoke<string[]>('watch_room_host', {
      code: session.roomCode, payload: JSON.stringify(wireState(session)),
    })
    watchParty.set(session)
    await consumeRecords(records, session)
  } catch (error) {
    await invoke('watch_room_leave').catch(() => {})
    throw error
  }
}

export async function joinWatchParty(code: string) {
  const clean = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, '')
  if (clean.length !== 6) throw new Error('Enter the six-character room code.')
  const provisional: WatchPartySession = {
    roomCode: clean, role: 'guest', joinedAt: Date.now(), hostDeviceId: '',
  }
  resetSyncState()
  resetTransferState()
  resetReactionState()
  try {
    const records = await invoke<string[]>('watch_room_join', {
      code: clean, payload: JSON.stringify(wireState(provisional)),
    })
    const host = liveRoomHost(records, clean)
    if (!host) throw new Error('The host did not confirm this room.')
    const session = { ...provisional, hostDeviceId: host.deviceId }
    watchParty.set(session)
    await consumeRecords(records, session)
  } catch (error) {
    await invoke('watch_room_leave').catch(() => {})
    throw error
  }
}

export async function leaveWatchParty() {
  watchParty.set(null)
  partyParticipants.set([])
  partyError.set('')
  lastHostPlayback = undefined
  lastRemotePlayback = undefined
  resetSyncState()
  resetTransferState()
  resetReactionState()
  await invoke('watch_room_leave').catch(() => {})
}

/** Nominate a live guest as the next playback authority. The transfer then completes through the
 * heartbeat state machine; this call returns once the authenticated request is published. */
export async function transferWatchPartyHost(targetDeviceId: string) {
  const session = get(watchParty)
  if (!session || session.role !== 'host') throw new Error('Only the current host can transfer room controls.')
  if (outgoingTransfer || finishingTransfer) throw new Error('A host transfer is already in progress.')
  const target = get(partyParticipants).find((participant) =>
    participant.deviceId === targetDeviceId && participant.role === 'guest')
  if (!target) throw new Error('That participant is no longer available.')
  const transfer: PartyHostTransfer = {
    id: `${localDeviceId()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    from: session.hostDeviceId,
    to: target.deviceId,
    phase: 'request',
    requestedAt: Date.now(),
  }
  outgoingTransfer = transfer
  partyHostTransfer.set({
    id: transfer.id,
    targetDeviceId: target.deviceId,
    targetName: target.name,
    phase: 'requesting',
  })
  partyNotice.set(`Waiting for ${target.name} to accept room controls…`)
  try { await exchange() }
  catch (error) {
    outgoingTransfer = undefined
    partyHostTransfer.set(null)
    throw error
  }
}

/** Send a short-lived reaction to the current room. The event is shown immediately, advertised for
 * six seconds, then forgotten; only its ID remains briefly in memory to suppress replay. */
export async function sendPartyReaction(emoji: PartyReactionEmoji) {
  const session = get(watchParty)
  if (!session) throw new Error('Join a Watch Together room before reacting.')
  if (!PARTY_REACTION_EMOJIS.includes(emoji)) throw new Error('That reaction is not supported.')
  const now = Date.now()
  reactionSends = reactionSends.filter((sentAt) => now - sentAt < 10_000)
  const rateError = reactionRateError(reactionSends, now)
  if (rateError) throw new Error(rateError)
  reactionSends.push(now)
  const sender = localDeviceId()
  const current = get(nowPlayingMedia)
  const reaction: PartyReaction = {
    id: `${sender}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sender,
    emoji,
    mediaId: current?.media.id,
    episode: current?.episode,
    position: Math.max(0, localClock.position),
  }
  localReactions = [...localReactions, reaction].slice(-6)
  seenReactions.set(reaction.id, now)
  const ownName = get(partyDisplayName) || 'You'
  showReaction({ ...reaction, name: ownName, own: true, receivedAt: now })
  setTimeout(() => { localReactions = localReactions.filter((item) => item.id !== reaction.id) }, 6_000)
  await exchange()
}

/** Feed the shared clock from either desktop or Android's embedded player.
 *  `buffering` is the player's own stall signal — it drives the host-side buffer gate and stops
 *  guests extrapolating through a host that isn't actually advancing. */
export function reportWatchPlayback(position: number, duration: number, paused: boolean, buffering = false) {
  localClock = { position, duration, paused, buffering }
  localReadiness = buffering ? 'buffering' : duration > 0 ? 'ready' : get(nowPlayingMedia) ? 'loading' : 'waiting'
  const session = get(watchParty)
  if (!session || session.role !== 'host' || applyingRemote) return
  const now = Date.now()
  if (now - lastPublished < 750) return
  const current = get(nowPlayingMedia)
  if (!current) return
  const shared = get(nowPlayingPartySource)
  lastPublished = now
  const playback: PartyPlayback = {
    media: current.media, episode: current.episode, position, duration, paused, buffering,
    source: shared.source ?? undefined, sourceError: shared.error || undefined,
    sequence: ++sequence, sentAt: now,
  }
  lastHostPlayback = playback
  void exchange(playback).catch((error) => partyError.set(error instanceof Error ? error.message : String(error)))
}

let initialized = false
export function initWatchTogether() {
  if (initialized) return () => {}
  initialized = true
  const heartbeat = setInterval(() => {
    if (get(watchParty)) {
      const host = get(watchParty)?.role === 'host'
      const active = get(playing) || get(androidMpvActive)
      if (host && active && get(nowPlayingMedia)) {
        reportWatchPlayback(localClock.position, localClock.duration, localClock.paused, localClock.buffering)
      } else {
        if (host) {
          lastHostPlayback = undefined
          localReadiness = 'waiting'
        }
        void refreshWatchParty()
      }
    }
  }, 1_000)
  return () => { clearInterval(heartbeat); initialized = false }
}
