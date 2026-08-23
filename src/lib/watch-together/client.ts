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
export interface WatchPartySession { roomCode: string; role: PartyRole; joinedAt: number }
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
    return value
  } catch { return null }
}

export function liveRoomHost(records: string[], roomCode: string, now = Date.now()): PartyWireState | null {
  return records
    .map(parse)
    .filter((value): value is PartyWireState => !!value)
    .filter((value) => value.roomCode === roomCode && value.role === 'host' && now - value.updatedAt < LIVE_ROOM_MS)
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
  partyParticipants.set(states.map(participantFromWire))
  const peers = states.filter((value) => value.deviceId !== self)
  const host = states.filter((value) => value.role === 'host' && value.playback)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]

  if (session.role === 'host') {
    // Stamp every guest ping at the moment we read it; wireState pairs it with a publish stamp.
    inboundPings = Object.fromEntries(
      peers.filter((p) => p.ping).map((p) => [p.deviceId, { id: p.ping!.id, t0: p.ping!.t0, t1: now }]),
    )
    await applyBufferGate(peers.some((p) => p.buffering), now)
  } else {
    // Match the host's answer to the ping we still have outstanding. An id we no longer hold is a
    // replayed pong from an earlier exchange and must not produce a sample.
    const pong = host?.pongs?.[self] ?? peers.find((p) => p.role === 'host' && p.pongs?.[self])?.pongs?.[self]
    if (pong && pendingPing && pong.id === pendingPing.id) {
      clockSamples = pushSample(clockSamples, clockSample(pong.t0, pong.t1, pong.t2, now), now)
      pendingPing = null
    }
    partyNotice.set(peers.some((p) => p.role === 'host' && p.buffering) ? 'The host is buffering…' : '')
  }

  if (host?.playback) await applyHostPlayback(host.playback)
  partyError.set('')
}

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
  if (!get(watchParty)) { partyParticipants.set([]); return }
  try {
    await exchange()
  } catch (error) { partyError.set(error instanceof Error ? error.message : String(error)) }
}

export async function createWatchParty() {
  const session: WatchPartySession = { roomCode: generateRoomCode(), role: 'host', joinedAt: Date.now() }
  lastHostPlayback = undefined
  resetSyncState()
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
  const session: WatchPartySession = { roomCode: clean, role: 'guest', joinedAt: Date.now() }
  resetSyncState()
  try {
    const records = await invoke<string[]>('watch_room_join', {
      code: clean, payload: JSON.stringify(wireState(session)),
    })
    if (!liveRoomHost(records, clean)) throw new Error('The host did not confirm this room.')
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
  resetSyncState()
  await invoke('watch_room_leave').catch(() => {})
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
