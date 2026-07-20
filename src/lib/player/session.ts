import { writable, get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'
import type { DebridInfo } from '$lib/stremio/debrid/types'
import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'

// Open source-picker: set after Play resolves the cached streams;
// the picker lists them and `playStream` starts the chosen one. null = closed.
export const streamPicker = writable<{
  media: Media
  episode: number | undefined
  streams: Stream[]
  cachedCount: number
  resolving?: boolean
  playbackError?: string
} | null>(null)

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

// The resolved URL of the currently-loaded video. Populated on every load (embedded, external,
// cloud) purely so the DEV-ONLY "Copy URL" tool in the player's track menu can read it — the UI
// gates it behind import.meta.env.DEV, so it never surfaces in a production build.
export const nowPlayingUrl = writable('')

// True while the Game-mode on-screen keyboard is up. The controller translator routes A (type the
// focused key) / B (close) to it, and directional nav stays trapped on its keys.
export const oskOpen = writable(false)

// Exit-confirm prompt (Game mode): pressing Back (B) on the home screen opens this instead
// of doing nothing — there's nowhere further back to go, so we ask before quitting the app.
export const exitPrompt = writable(false)

// Advanced-search filters modal open. Like streamPicker, the controller translator routes B
// to close it (instead of navigating the page back, which would leave the search page).
export const advancedFiltersOpen = writable(false)

// Series-page AniList/MAL editor. While open, the Deck controller keeps directional focus inside
// the dialog, A activates its controls, and B dismisses it instead of leaving the series page.
export const listEditorOpen = writable(false)

// Game-mode track menu (Deck ☰ button): the controller-navigable audio/subtitle picker.
// While true it CAPTURES the pad — the app-wide nav translator and the player's own A/B/L1/R1
// handlers early-return so d-pad/A/B drive the menu instead of seeking/pausing/focus-nav.
export const trackMenuOpen = writable(false)

// True while any player popover (playback options / track list in Controls) is open. Drives the
// Game-mode snapshot overlay to its FAST (60fps) cadence so navigating those menus isn't laggy.
export const playerMenuOpen = writable(false)

// In-player discussion/comments panel (comment button → side panel). Keyed on nowPlaying.{id,malId,
// episode}. Desktop-first; Game-mode (mpv-snapshot) rendering of a scrollable panel is a later phase.
export const commentsOpen = writable(false)

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

// needsFetch subtitle candidates (OpenSubtitles / SubDL) found on play — listed in the in-player
// "Online subtitles" menu for manual pick. Populated by playStream at embed time; never sent to
// player_embed. `status` drives the menu's searching/empty states; reset each episode so stale rows
// from the previous one don't linger.
export const onlineSubCandidates = writable<{ status: 'idle' | 'searching' | 'ready' | 'error'; items: SubtitleCandidate[] }>({ status: 'idle', items: [] })

// Actionable subtitle-provider notice (e.g. quota reached / sign in again), shown in the subtitle
// menu. Parallel to playerNotice but NEVER flips PlayState to error — a subtitle failure must not
// kill video playback. '' = none.
export const subtitleNotice = writable<string>('')

// Cache key (infoHash, else `<mediaId>-<episode>`) of the stream now playing, used
// by the seekbar to request/poll its scrub-preview sprite sheet. null = no sprite.
export const spriteKey = writable<string | null>(null)

// Release identity of the stream now playing, so the NEXT episode can continue from
// the SAME release without re-picking — the "folder" behaviour. `group` is the parsed
// fansub/release author (e.g. "SakuraCircle"), which continues extension/fansub content
// that carries no Stremio bingeGroup. null when not playing / source unknown.
export const bingeSource = writable<{ mediaId: number; bingeGroup?: string; infoHash?: string; group?: string } | null>(null)

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
