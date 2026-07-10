import { writable, get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'
import type { DebridInfo } from '$lib/stremio/debrid/types'

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

// The Media + episode currently playing, so the player's "Change source" option can re-open the
// source picker for it mid-playback (the picker's onState/pick then swaps the stream in place).
export const nowPlayingMedia = writable<{ media: Media; episode: number | undefined } | null>(null)

// True while the Game-mode on-screen keyboard is up. The controller translator routes A (type the
// focused key) / B (close) to it, and directional nav stays trapped on its keys.
export const oskOpen = writable(false)

// Exit-confirm prompt (Game mode): pressing Back (B) on the home screen opens this instead
// of doing nothing — there's nowhere further back to go, so we ask before quitting the app.
export const exitPrompt = writable(false)

// Game-mode track menu (Deck ☰ button): the controller-navigable audio/subtitle picker.
// While true it CAPTURES the pad — the app-wide nav translator and the player's own A/B/L1/R1
// handlers early-return so d-pad/A/B drive the menu instead of seeking/pausing/focus-nav.
export const trackMenuOpen = writable(false)

// True while any player popover (playback options / track list in Controls) is open. Drives the
// Game-mode snapshot overlay to its FAST (60fps) cadence so navigating those menus isn't laggy.
export const playerMenuOpen = writable(false)

// Active debrid caching session: set while an UNCACHED torrent downloads at the debrid
// service, drives the full-screen DebridCaching progress screen. `cancel` aborts the poll
// (the torrent keeps caching at the service, so returning later is instant). null = idle.
export const debridCaching = writable<null | {
  provider: string
  title: string
  episode?: number
  cover?: string
  info: DebridInfo
  cancel: () => void
}>(null)

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

// Game mode (gamescope / Steam Deck): the app runs fullscreen with a TOUCH player
// and no windowed layout — video takes the whole screen, no sidebar/titlebar chrome
// while playing. Resolved once from Rust (`player_is_game_mode`) at boot. When true it
// implies "always fullscreen" for the chrome-hiding + video-inset logic.
export const gameMode = writable(false)
export async function initGameMode() {
  try { gameMode.set(await invoke<boolean>('player_is_game_mode')) }
  catch { /* non-linux / no window yet — stays false (Desktop/windowed) */ }
}

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
