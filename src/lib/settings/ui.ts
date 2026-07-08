import { persisted } from 'svelte-persisted-store'
import type { StreamSort } from '$lib/stremio/addon'

/** How the episode list renders. Names are intentionally generic. */
export type EpisodeLayout = 'cards' | 'compact'

/** Persisted episode-list layout preference (default: rich cards). */
export const episodeLayout = persisted<EpisodeLayout>('episode-layout', 'cards')

/** Which title to show for anime across the app (see `title()` in anilist/media). */
export type TitleLanguage = 'romaji' | 'english'
/** Persisted title-language preference (default: Romaji). */
export const titleLanguage = persisted<TitleLanguage>('title-language', 'romaji')

/** Game-mode player: place the now-playing title at the TOP of the player (by the Back
 *  button) instead of just above the seek bar. Default off (title above the seek bar). */
export const playerTitleTop = persisted<boolean>('player-title-top', false)

/**
 * Auto-skip OP/ED/recap segments (from AniSkip) during playback. When on, the
 * player seeks past a segment automatically the first time the playhead enters it
 * (seeking back in still lets you watch it). When off, only the manual "Skip"
 * button shows. Default off.
 */
export const autoSkip = persisted<boolean>('player-auto-skip', false)

/** Skip filler episodes during auto next-episode (AnimeFillerList data). Filler is
 *  always *marked* in the episode list; this controls whether auto-advance skips it. */
export const skipFiller = persisted<boolean>('player-skip-filler', false)

// --- Playback language preferences (mpv alang/slang auto-selection) ---
// ISO 639-2 codes. Default JP audio + EN subs.
export type AudioLang = 'jpn' | 'eng'
export type SubLang = 'eng' | 'jpn' | 'none'
export const preferredAudioLang = persisted<AudioLang>('preferred-audio-lang', 'jpn')
export const preferredSubLang = persisted<SubLang>('preferred-sub-lang', 'eng')

// --- Source selection ---
/** Skip the source picker and auto-play the best source at (or near) the preferred
 *  quality. Off = always show the picker. */
export const autoSelectSource = persisted<boolean>('auto-select-source', false)
export type Quality = '2160' | '1080' | '720' | '480' | 'any'
export const preferredQuality = persisted<Quality>('preferred-quality', '1080')

// --- Source picker ---
/** Show dead/down sources (uncached torrents with no seeders) in the picker.
 *  Off = hidden (they always sink to the bottom and are never auto-played). */
export const showDeadSources = persisted<boolean>('show-dead-sources', false)
/** Within-cache-tier sort order for the source picker. */
export const preferredStreamSort = persisted<StreamSort>('preferred-stream-sort', 'quality')

// --- Player behaviour ---
/** Auto-play the next episode when one finishes. Default on. */
export const autoplayNext = persisted<boolean>('player-autoplay-next', true)
/** Binge next episode: keep the SAME release across episodes (Stremio bingeGroup) so
 *  the next one doesn't re-pick a source, and pre-resolve + warm-buffer it as the
 *  current episode nears the end so Next/auto-advance starts instantly. Default on. */
export const bingePreload = persisted<boolean>('player-binge-preload', true)
/** Seconds the -N/+N buttons and arrow keys seek. */
export const seekDuration = persisted<number>('player-seek-seconds', 10)
/** Show the frame-preview thumbnail while skimming the seek bar. Off = time/chapter only
 *  (also skips the on-demand frame grab — lighter on the Deck iGPU). */
export const scrubThumbnails = persisted<boolean>('player-scrub-thumbnails', true)
/** How video fits the player area. 'best' = keep aspect (letterbox, default); 'fill' =
 *  crop to fill the frame (mpv panscan). */
export type VideoFit = 'best' | 'fill'
export const videoFit = persisted<VideoFit>('video-fit', 'best')
/** Play in an external player (mpv/VLC/…) instead of the embedded one. No progress
 *  tracking/resume while external (we get no playback events back). */
export const enableExternalPlayer = persisted<boolean>('external-player-enabled', false)
/** Absolute path to the external player executable (e.g. C:\\Program Files\\mpv\\mpv.exe). */
export const externalPlayerPath = persisted<string>('external-player-path', '')

// --- Interface ---
/** Blur thumbnails/titles/ratings of UNWATCHED episodes on shows you're watching. */
export const hideSpoilers = persisted<boolean>('hide-spoilers', false)
/** Let the mouse wheel scroll carousel rows horizontally (vertical wheel → sideways).
 *  Off by default: use the row's ‹ › arrow buttons instead. */
export const wheelScrollAcross = persisted<boolean>('carousel-wheel-scroll', false)
/** WebView zoom factor for the whole UI (0.5–2.0). */
export const uiScale = persisted<number>('ui-scale', 1)
/** Include 18+ / adult titles in browse + search (AniList isAdult filter). */
export const showAdult = persisted<boolean>('show-adult', false)

// --- Updates ---
/** Auto-updater release channel: 'stable' (normal GitHub releases) or 'beta'
 *  (GitHub pre-releases). Drives which endpoint the updater checks. */
export const updateChannel = persisted<'stable' | 'beta'>('update-channel', 'stable')

// --- Network ---
// NOTE: these are best-effort for our debrid + libmpv model (see settings copy).
/** Prefer DNS-over-HTTPS. Best-effort: our addon/AniList/mpv requests each use their
 *  own resolver, so there's no single funnel to force this through yet. */
export const enableDoH = persisted<boolean>('doh-enabled', false)
export const doHUrl = persisted<string>('doh-url', 'https://cloudflare-dns.com/dns-query')
/** Transfer speed limit (Mb/s). Applies to torrent downloads; inert with debrid
 *  streaming (Real-Debrid serves over its own CDN — nothing local to throttle). */
export const transferSpeedLimit = persisted<number>('transfer-speed-limit', 40)

// --- Source extensions ---
/** Which debrid service resolves extension torrent results. */
export const debridProvider = persisted<string>('debrid-provider', 'realdebrid')
/** Debrid service API token (or "user:pass" for Mega-Debrid), used to resolve
 *  extension torrent results (infoHash → cached HTTP url). Separate from any key
 *  embedded in Stremio addon URLs. Secret. */
export const debridKey = persisted<string>('debrid-key', '')
/** Installed source-extension manifest URLs (JSON manifests or gh:/npm: shorthand). */
export const extensionUrls = persisted<string[]>('extension-urls', [])

// --- Offline downloads ---
/** Where downloaded episodes are written. Empty = app-data/downloads (resolved in Rust). */
export const downloadDir = persisted<string>('download-dir', '')
/** Max simultaneous downloads (1–2 recommended for a debrid CDN + disk). */
export const downloadConcurrency = persisted<number>('download-concurrency', 1)
/** Bulk "Download all" only enqueues episodes with a cached source. */
export const downloadCachedOnly = persisted<boolean>('download-cached-only', true)
