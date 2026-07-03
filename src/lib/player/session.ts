import { writable, get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'

// Open source-picker (izumi-style): set after Play resolves the cached streams;
// the picker lists them and `playStream` starts the chosen one. null = closed.
export const streamPicker = writable<{ media: Media; episode: number | undefined; streams: Stream[] } | null>(null)

// Single-window player session. `playing` toggles the in-app player overlay (and
// the transparent "hole" that lets mpv, embedded in the main window, show
// through). `nowPlaying` tells the overlay what to display + which ids to fetch
// AniSkip OP/ED segments for. Both are set by `playEpisode` in stremio/play.ts.
export const playing = writable(false)
export const nowPlaying = writable<{ title: string; malId: number | null; episode: number | null }>({
  title: '',
  malId: null,
  episode: null,
})

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
