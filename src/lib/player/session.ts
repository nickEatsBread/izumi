import { writable, get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'
import type { Rejection } from '$lib/stremio/refine'
import type { DebridInfo } from '$lib/stremio/debrid/types'
import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'
import type { SharedSourceState } from '$lib/watch-together/source'
import type { DirectTorrentHealth } from '$lib/player/direct-torrent'
import type { Chapter } from '$lib/player/chapter-skip'

// Open source-picker: set after Play resolves the cached streams;
// the picker lists them and `playStream` starts the chosen one. null = closed.
export const streamPicker = writable<{
  media: Media
  episode: number | undefined
  streams: Stream[]
  // Rows the title/production/season heuristics removed, each with the rule that removed it. Kept
  // so the picker can say "12 filtered" and show them on request: silently dropping everything and
  // then reporting "no usable sources" blamed the addons for our own filtering.
  rejected?: Rejection[]
  cachedCount: number
  resolving?: boolean
  // The autoplay countdown may start. Deliberately NOT `!resolving`: waiting for every source to
  // settle means waiting out the slowest addon's whole budget (and a wedged provider's 20s cap)
  // before a cancel window that the user is going to let run anyway — while a cached, in-language,
  // season-verified row has been sitting on screen since the first second. Set once a pick is
  // trustworthy, and unconditionally when the resolve finishes.
  autoReady?: boolean
  playbackError?: string
  // "Change source" is always a user choice, regardless of the global automatic-source setting.
  manualOnly?: boolean
  // Preserve play/pause intent while replacing the current file.
  autoplay?: boolean
  // Rendered as nothing while STAYING the current request. Automatic binge continuation uses
  // this while it searches for the previous episode's release; clearing the store would make the
  // resolve flow treat that search as superseded and abandon it.
  hidden?: boolean
} | null>(null)

/** A source is being turned into something playable. Owns the "connecting" screen, which has to
 *  work when there is no picker on screen at all — binge continuation and Continue Watching both
 *  resolve with the picker closed, and they were falling straight through to the debrid caching
 *  screen even when debrid was not what they were waiting for. */
export const connecting = writable<{ title: string; detail?: string; art?: string; cancel: () => void } | null>(null)

/** The next episode has been resolved ahead of time and will start immediately. Purely additive:
 *  it is only ever set when a preload actually succeeded, because under the noAdd contract a
 *  release the account does not already hold is deliberately left alone — so "not ready" is the
 *  normal state and saying so would be noise rather than information. */
export const nextEpisodeReady = writable<{ mediaId: number; episode: number } | null>(null)

// Single-window player session. `playing` toggles the in-app player overlay (and
// the transparent "hole" that lets mpv, embedded in the main window, show
// through). `nowPlaying` tells the overlay what to display + which ids to fetch
// AniSkip OP/ED segments for. Both are set by `playEpisode` in stremio/play.ts.
export const playing = writable(false)
// Monotonic file-load identity. Unlike media/episode or spriteKey, this changes even when
// "Change source" replaces an online stream that has no infoHash, so the overlay can discard
// every pause/EOF/frame flag belonging to the previous mpv file.
export const playerLoadId = writable(0)
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

// Credential-safe identity of the source selected before any debrid resolution.
// Watch Together sends this instead of nowPlayingUrl, which may be account-bound.
export const nowPlayingPartySource = writable<SharedSourceState>({ source: null, error: '' })

// The resolved URL of the currently-loaded video. Populated on every load (embedded, external,
// cloud) purely so the DEV-ONLY "Copy URL" tool in the player's track menu can read it — the UI
// gates it behind import.meta.env.DEV, so it never surfaces in a production build.
export const nowPlayingUrl = writable('')
/** Network context for ffmpeg-backed subtitle synchronization. Kept internal to the player and
 * never displayed or persisted because headers can contain provider credentials. */
export const nowPlayingStream = writable<{
  url: string
  headers: Record<string, string>
  infoHash: string | null
}>({ url: '', headers: {}, infoHash: null })

/** Source candidates retained after the picker closes. The playback watchdog uses this exact
 * ranked pool to recover from a source that starts but later freezes, instead of reopening a
 * resolver and potentially selecting the same broken release again. URLs may contain credentials,
 * so this is deliberately memory-only and is cleared/replaced with each episode. */
export const playbackRecovery = writable<{
  media: Media
  episode: number | undefined
  streams: Stream[]
  current: Stream | null
  attempted: string[]
  recovering: boolean
} | null>(null)

export const playerStatsOpen = writable(false)
/** Last direct-P2P engine sample, refreshed by the overlay's 1 Hz watchdog tick. Null whenever the
 * current source is not a local torrent stream. Read by the stats overlay so a stuck torrent can be
 * told apart from a stuck player without a debugger. */
export const directTorrentStats = writable<DirectTorrentHealth | null>(null)
export const playerSleep = writable<{ deadline: number | null; atEpisodeEnd: boolean }>({
  deadline: null,
  atEpisodeEnd: false,
})
export const playerAbLoop = writable<{ a: number | null; b: number | null }>({ a: null, b: null })
export const gifRecordingStart = writable<number | null>(null)

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

// The playing file's chapter marks, sorted, or [] when it has none. Written by whichever player
// component parsed them (desktop or Android), read by the menus that offer them as a jump list.
// Shared rather than kept per-component so the two players cannot drift — the desktop-only fix for
// stale skip segments after a source switch was exactly that kind of drift.
export const chapters = writable<Chapter[]>([])

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

// External subtitle files bundled beside the selected video in a direct torrent. Video playback
// starts first; these tracks are attached live as their tiny files arrive in the background.
// `revision` lets an already-open track menu refresh after each successful mpv sub-add.
export const torrentSubtitleState = writable<{
  playbackId: number | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  loaded: number
  total: number
  revision: number
}>({ playbackId: null, status: 'idle', loaded: 0, total: 0, revision: 0 })

// Cache key (infoHash, else `<mediaId>-<episode>`) of the stream now playing, used
// by the seekbar to request/poll its scrub-preview sprite sheet. null = no sprite.
export const spriteKey = writable<string | null>(null)

// Release identity of the stream now playing, so the NEXT episode can continue from
// the SAME release without re-picking — the "folder" behaviour. `group` is the parsed
// fansub/release author (e.g. "SakuraCircle"), which continues extension/fansub content
// that carries no Stremio bingeGroup. null when not playing / source unknown.
// `originId` is what continues a DIRECT source across episodes. A torrent row is identified by its
// bingeGroup / infoHash / release group, but an online-stream row has none of those — no infoHash,
// no bingeGroup, and a filename that carries no release group — so continuity never matched for
// them and the picker reopened on every episode.
export const bingeSource = writable<{ mediaId: number; bingeGroup?: string; infoHash?: string; group?: string; originId?: string; online?: boolean; audio?: 'sub' | 'dub' } | null>(null)

// Fullscreen state of the MAIN window while playing. Drives hiding the
// sidebar/titlebar chrome for edge-to-edge video. Kept in sync with the actual
// window state via the Rust command's return value.
export const fullscreen = writable(false)
export const pictureInPicture = writable(false)

// Game mode (gamescope / Steam Deck): the app runs fullscreen with a TOUCH player
// and no windowed layout — video takes the whole screen, no sidebar/titlebar chrome
// while playing. Resolved once from Rust (`player_is_game_mode`) at boot. When true it
// implies "always fullscreen" for the chrome-hiding + video-inset logic.
export const gameMode = writable(false)
/** True once native Game-mode detection has answered (including an error fallback). */
export const gameModeResolved = writable(false)
export async function initGameMode() {
  try { gameMode.set(await invoke<boolean>('player_is_game_mode')) }
  catch { /* non-linux / no window yet — stays false (Desktop/windowed) */ }
  finally { gameModeResolved.set(true) }
}

export async function toggleFullscreen() {
  if (get(pictureInPicture)) await exitPictureInPicture()
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

/** Desktop miniplayer uses the existing main window and embedded mpv instance, so playback remains
 * uninterrupted. Android owns its native Activity PiP and does not call this path. */
export async function togglePictureInPicture() {
  if (get(fullscreen)) await exitFullscreen()
  try {
    pictureInPicture.set(await invoke<boolean>('player_toggle_pip'))
  } catch (error) {
    console.warn('toggle picture-in-picture', error)
    playerNotice.set(error instanceof Error ? error.message : String(error))
  }
}

export async function exitPictureInPicture() {
  if (!get(pictureInPicture)) return
  try {
    pictureInPicture.set(await invoke<boolean>('player_toggle_pip'))
  } catch (error) {
    console.warn('exit picture-in-picture', error)
  }
}
