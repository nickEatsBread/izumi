import { writable, get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'

// Open source-picker: set after Play resolves the cached streams;
// the picker lists them and `playStream` starts the chosen one. null = closed.
export const streamPicker = writable<{ media: Media; episode: number | undefined; streams: Stream[]; cachedCount: number; resolving?: boolean } | null>(null)

// Single-window player session. `playing` toggles the in-app player overlay (and
// the transparent "hole" that lets mpv, embedded in the main window, show
// through). `nowPlaying` tells the overlay what to display + which ids to fetch
// AniSkip OP/ED segments for. Both are set by `playEpisode` in stremio/play.ts.
export const playing = writable(false)
export const nowPlaying = writable<{
  title: string
  animeTitle: string
  id: number | null
  malId: number | null
  episode: number | null
  total: number | null // planned episode count (for the "N / Total" label)
  airedTotal: number | null // last aired episode (gates the Next button)
}>({
  title: '',
  animeTitle: '',
  id: null,
  malId: null,
  episode: null,
  total: null,
  airedTotal: null,
})

// Transient toast shown in the player overlay (e.g. "Loading next episode…",
// "Next episode has no cached source"). Cleared automatically by the overlay.
export const playerNotice = writable<string>('')

// Cache key (infoHash, else `<mediaId>-<episode>`) of the stream now playing, used
// by the seekbar to request/poll its scrub-preview sprite sheet. null = no sprite.
export const spriteKey = writable<string | null>(null)

// Release identity of the stream now playing, so the NEXT episode can continue from
// the SAME release/torrent (Stremio bingeGroup) without re-picking — the
// "folder" behaviour. null when not playing / source unknown.
export const bingeSource = writable<{ mediaId: number; bingeGroup?: string; infoHash?: string } | null>(null)

// Fullscreen state of the MAIN window while playing. Drives hiding the
// sidebar/titlebar chrome for edge-to-edge video. Kept in sync with the actual
// window state via the Rust command's return value.
export const fullscreen = writable(false)

export async function toggleFullscreen() {
  try { fullscreen.set(await invoke<boolean>('player_toggle_fullscreen')) }
  catch (e) { console.warn('toggle fullscreen', e) }
}
// Ensure we leave fullscreen (called on close) so browse isn't stuck fullscreen.
export async function exitFullscreen() {
  if (!get(fullscreen)) return
  fullscreen.set(false)
  try { await invoke('player_exit_fullscreen') }
  catch (e) { console.warn('exit fullscreen', e) }
}
