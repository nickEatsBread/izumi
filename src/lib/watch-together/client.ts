import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { nowPlayingMedia, nowPlayingPartySource, playing } from '$lib/player/session'
import { playStream } from '$lib/stremio/play'
import { isAndroid } from '$lib/platform'
import { androidMpvActive, seekAbsolute, setPaused } from '$lib/player/android-mpv'
import type { Media } from '$lib/anilist/types'
import { parseSharedSource, sharedSourceKey, streamFromSharedSource, type SharedSource } from './source'

export type PartyRole = 'host' | 'guest'
export interface WatchPartySession { roomCode: string; role: PartyRole; joinedAt: number }
export interface PartyParticipant { deviceId: string; name: string; role: PartyRole; updatedAt: number }
interface PartyPlayback {
  media: Media
  episode?: number
  source?: SharedSource
  sourceError?: string
  position: number
  duration: number
  paused: boolean
  sequence: number
  sentAt: number
}
interface PartyWireState extends PartyParticipant {
  app: 'izumi'
  kind: 'watch-party'
  version: 1
  roomCode: string
  playback?: PartyPlayback
}

const LIVE_ROOM_MS = 30_000

// Room membership is intentionally ephemeral. It must never restore or attach
// the user to a persistent Device Sync group after restarting Izumi.
export const watchParty = writable<WatchPartySession | null>(null)
export const partyParticipants = writable<PartyParticipant[]>([])
export const partyError = writable('')
export const partySyncing = writable(false)
const partyDeviceId = persisted<string>('watch-party-device-id-v1', '')
const partyDisplayName = persisted<string>('watch-party-name-v1', '')

let localClock = { position: 0, duration: 0, paused: false }
let sequence = 0
let lastPublished = 0
let lastHostPlayback: PartyPlayback | undefined
let applyingRemote = false
let loadingRemote = ''
let remoteRequestedAt = 0

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
  return {
    app: 'izumi', kind: 'watch-party', version: 1,
    roomCode: session.roomCode, role: session.role, deviceId,
    name: get(partyDisplayName) || `${navigator.platform || 'Izumi'} ${deviceId.slice(0, 6)}`,
    updatedAt: Date.now(), playback,
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

async function commandRemote(position: number, paused: boolean) {
  if (get(isAndroid) && get(androidMpvActive)) {
    if (Math.abs(localClock.position - position) > 2.5) await seekAbsolute(position)
    if (localClock.paused !== paused) await setPaused(paused)
    return
  }
  if (Math.abs(localClock.position - position) > 2.5) {
    await invoke('player_command', { name: 'seek', args: [position.toFixed(3), 'absolute+exact'] })
  }
  if (localClock.paused !== paused) {
    await invoke('player_command', { name: 'set', args: ['pause', paused ? 'yes' : 'no'] })
  }
}

async function applyHostPlayback(playback: PartyPlayback) {
  const session = get(watchParty)
  if (!session || session.role !== 'guest' || applyingRemote) return
  if (!playback.source) throw new Error(playback.sourceError || 'The host source cannot be shared safely. Ask the host to choose a torrent or credential-free HTTP source.')
  const sourceKey = sharedSourceKey(playback.source)
  const key = `${playback.media.id}:${playback.episode ?? 0}:${sourceKey}`
  const current = get(nowPlayingMedia)
  const localSourceKey = sharedSourceKey(get(nowPlayingPartySource).source)
  if (!current || current.media.id !== playback.media.id || current.episode !== playback.episode || localSourceKey !== sourceKey) {
    if (loadingRemote === key && Date.now() - remoteRequestedAt < 30_000) return
    loadingRemote = key
    remoteRequestedAt = Date.now()
    partySyncing.set(true)
    try {
      let playbackError = ''
      await playStream(playback.media, playback.episode, streamFromSharedSource(playback.source), (state) => {
        if (state.status === 'error') playbackError = state.message || 'The host source could not be opened.'
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
    const target = playback.paused ? playback.position : playback.position + Math.max(0, (Date.now() - playback.sentAt) / 1000)
    await commandRemote(Math.min(playback.duration || target, target), playback.paused)
  } catch (error) {
    partyError.set(error instanceof Error ? error.message : String(error))
  } finally { applyingRemote = false }
}

async function consumeRecords(records: string[], session: WatchPartySession) {
  const states = records.map(parse).filter((value): value is PartyWireState => !!value)
    .filter((value) => value.roomCode === session.roomCode && Date.now() - value.updatedAt < LIVE_ROOM_MS)
  partyParticipants.set(states.map(({ deviceId, name, role, updatedAt }) => ({ deviceId, name, role, updatedAt })))
  const host = states.filter((value) => value.role === 'host' && value.playback)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  if (host?.playback) await applyHostPlayback(host.playback)
  partyError.set('')
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
  await invoke('watch_room_leave').catch(() => {})
}

/** Feed the shared clock from either desktop or Android's embedded player. */
export function reportWatchPlayback(position: number, duration: number, paused: boolean) {
  localClock = { position, duration, paused }
  const session = get(watchParty)
  if (!session || session.role !== 'host' || applyingRemote) return
  const now = Date.now()
  if (now - lastPublished < 750) return
  const current = get(nowPlayingMedia)
  if (!current) return
  const shared = get(nowPlayingPartySource)
  lastPublished = now
  const playback: PartyPlayback = {
    media: current.media, episode: current.episode, position, duration, paused,
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
      if (get(watchParty)?.role === 'host' && get(nowPlayingMedia)) reportWatchPlayback(localClock.position, localClock.duration, localClock.paused)
      else void refreshWatchParty()
    }
  }, 1_000)
  return () => { clearInterval(heartbeat); initialized = false }
}
