import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { getSyncStatus, syncDeviceName } from '$lib/sync/client'
import type { SyncRecord } from '$lib/sync/types'
import { nowPlayingMedia, playing } from '$lib/player/session'
import { playEpisode } from '$lib/stremio/play'
import { isAndroid } from '$lib/platform'
import { androidMpvActive, seekAbsolute, setPaused } from '$lib/player/android-mpv'
import type { Media } from '$lib/anilist/types'

export type PartyRole = 'host' | 'guest'
export interface WatchPartySession { roomCode: string; role: PartyRole; joinedAt: number }
export interface PartyParticipant { deviceId: string; name: string; role: PartyRole; updatedAt: number }
interface PartyPlayback {
  media: Media
  episode?: number
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

export const watchParty = persisted<WatchPartySession | null>('watch-party-session-v1', null)
export const partyParticipants = writable<PartyParticipant[]>([])
export const partyError = writable('')
export const partySyncing = writable(false)

let endpointId = ''
let localClock = { position: 0, duration: 0, paused: false }
let sequence = 0
let lastPublished = 0
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

async function readyEndpoint() {
  const status = await getSyncStatus()
  if (status.state !== 'ready' || !status.paired) throw new Error('Pair this device in Settings → Device sync first.')
  endpointId = status.endpointId
  return status
}

async function writeState(playback?: PartyPlayback) {
  const session = get(watchParty)
  if (!session) return
  if (!endpointId) await readyEndpoint()
  const state: PartyWireState = {
    app: 'izumi', kind: 'watch-party', version: 1,
    roomCode: session.roomCode, role: session.role, deviceId: endpointId,
    name: get(syncDeviceName) || `Izumi ${endpointId.slice(0, 6)}`,
    updatedAt: Date.now(), playback,
  }
  await invoke('sync_write', { category: 'watch-party', payload: JSON.stringify(state) })
}

function parse(record: SyncRecord): PartyWireState | null {
  try {
    const value = JSON.parse(record.payload) as PartyWireState
    if (value?.app !== 'izumi' || value.kind !== 'watch-party' || value.version !== 1 || !value.roomCode) return null
    return { ...value, deviceId: record.deviceId }
  } catch { return null }
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
  const key = `${playback.media.id}:${playback.episode ?? 0}`
  const current = get(nowPlayingMedia)
  if (!current || current.media.id !== playback.media.id || current.episode !== playback.episode) {
    if (loadingRemote === key && Date.now() - remoteRequestedAt < 30_000) return
    loadingRemote = key
    remoteRequestedAt = Date.now()
    partySyncing.set(true)
    try {
      // Each participant resolves their own source. The normal picker remains available when
      // auto-select is disabled or no immediately playable source exists.
      await playEpisode(playback.media, playback.episode, () => {})
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

export async function refreshWatchParty() {
  const session = get(watchParty)
  if (!session) { partyParticipants.set([]); return }
  try {
    if (!endpointId) await readyEndpoint()
    const records = await invoke<SyncRecord[]>('sync_read', { category: 'watch-party' })
    const states = records.map(parse).filter((value): value is PartyWireState => !!value)
      .filter((value) => value.roomCode === session.roomCode && Date.now() - value.updatedAt < 30_000)
    partyParticipants.set(states.map(({ deviceId, name, role, updatedAt }) => ({ deviceId, name, role, updatedAt })))
    const host = states.filter((value) => value.role === 'host' && value.playback)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (host?.playback) await applyHostPlayback(host.playback)
    partyError.set('')
  } catch (error) { partyError.set(error instanceof Error ? error.message : String(error)) }
}

export async function createWatchParty() {
  await readyEndpoint()
  watchParty.set({ roomCode: generateRoomCode(), role: 'host', joinedAt: Date.now() })
  await writeState()
  await refreshWatchParty()
}

export async function joinWatchParty(code: string) {
  await readyEndpoint()
  const clean = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, '')
  if (clean.length !== 6) throw new Error('Enter the six-character room code.')
  watchParty.set({ roomCode: clean, role: 'guest', joinedAt: Date.now() })
  await writeState()
  await refreshWatchParty()
}

export function leaveWatchParty() {
  watchParty.set(null)
  partyParticipants.set([])
  partyError.set('')
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
  lastPublished = now
  void writeState({
    media: current.media, episode: current.episode, position, duration, paused,
    sequence: ++sequence, sentAt: now,
  }).catch((error) => partyError.set(error instanceof Error ? error.message : String(error)))
}

let initialized = false
export function initWatchTogether() {
  if (initialized) return () => {}
  initialized = true
  const heartbeat = setInterval(() => {
    if (get(watchParty)) {
      if (get(watchParty)?.role === 'host' && get(nowPlayingMedia)) reportWatchPlayback(localClock.position, localClock.duration, localClock.paused)
      else void writeState().catch(() => {})
      void refreshWatchParty()
    }
  }, 5_000)
  const unlisten = listen('iroh-sync-update', () => { if (get(watchParty)) void refreshWatchParty() })
  if (get(watchParty)) void refreshWatchParty()
  return () => { clearInterval(heartbeat); void unlisten.then((stop) => stop()); initialized = false }
}
