import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
import type { StreamSort } from '$lib/stremio/addon'

/** How the episode list renders. Names are intentionally generic. */
export type EpisodeLayout = 'cards' | 'compact'

/** Persisted episode-list layout preference (default: rich cards). */
export const episodeLayout = persisted<EpisodeLayout>('episode-layout', 'cards')

/** What removing a series from Continue Watching (press D on a card) also does to the tracker.
 *  'none' = just hide it from the row (default). */
export type CwDismissAction = 'none' | 'paused' | 'dropped'
export const cwDismissAction = persisted<CwDismissAction>('cw-dismiss-action', 'none')

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
/** Auto-play the best cached source: when the source list settles, count down ~5s (the Auto
 *  button fills left→right) then play the best match at (or near) the preferred quality. Cancel
 *  by picking another source or interacting. Default ON — turn off to always choose manually.
 *  (Fresh `autoplay-best` key so the new default reliably reaches existing installs.) */
export const autoSelectSource = persisted<boolean>('autoplay-best', true)
/** Animate the auto-select countdown (the filling Auto-button bar + pulse). Off = pick instantly
 *  with no animation. Also auto-disabled when the OS requests reduced motion. */
export const autoSelectAnimate = persisted<boolean>('auto-select-animate', true)
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
/** Keep the screen awake (no dim/sleep) while a video is playing — fixes the Steam Deck
 *  turning the screen off mid-episode. Released when paused / stopped, so battery-saver still
 *  kicks in when you're not watching. Default on. */
export const keepAwakeWhilePlaying = persisted<boolean>('player-keep-awake', true)
/** Player demuxer read-ahead cache in MiB — the main tunable playback RAM cost. Presets:
 *  Low 32 / Balanced 128 / High 256; any value is allowed (Custom); CACHE_UNCAPPED = no ceiling.
 *  The stored value is a BASELINE that auto-scales up with the file's bitrate (see playerCacheBytes)
 *  so a 4K Blu-ray buffers as many seconds as the preset holds at 1080p. Pushed via set_player_cache. */
export const playerCacheMb = persisted<number>('player-cache-mb', 128)

/** Sentinel `playerCacheMb` value for the "Uncapped" preset — buffer the whole file (up to a large
 *  RAM safety ceiling), no preset limit. */
export const CACHE_UNCAPPED = -1
const CACHE_MB = 1024 * 1024
// A typical 1080p bitrate (~12 Mbps). The preset's byte budget represents "however many seconds
// that holds at THIS bitrate"; higher-bitrate files scale the bytes up to keep the same duration.
const CACHE_REF_BITRATE = 1_500_000 // bytes/sec
const CACHE_SCALE_CAP = 1024 * CACHE_MB // RAM ceiling for the auto-scaled presets
const CACHE_UNCAPPED_CAP = 4096 * CACHE_MB // hard safety ceiling for Uncapped

/** Demuxer cache bytes for a specific file. Presets act as a FLOOR that scales UP with the file's
 *  bitrate — so a 4K Blu-ray (huge bytes/sec) buffers as many SECONDS as the preset holds for 1080p,
 *  instead of a fixed byte cap that empties in a few seconds and rebuffers — capped for RAM safety.
 *  Uncapped buffers the whole file up to a large ceiling. `videoSize` (bytes) + `durationSec` give
 *  the bitrate; with either unknown the preset is used unscaled. */
export function playerCacheBytes(cacheMb: number, videoSize?: number, durationSec?: number): number {
  if (cacheMb === CACHE_UNCAPPED) return Math.min(videoSize || CACHE_UNCAPPED_CAP, CACHE_UNCAPPED_CAP)
  const base = Math.max(8, cacheMb) * CACHE_MB
  if (videoSize && durationSec && durationSec > 0) {
    const bitrate = videoSize / durationSec // bytes/sec
    return Math.round(Math.min(CACHE_SCALE_CAP, base * Math.max(1, bitrate / CACHE_REF_BITRATE)))
  }
  return base
}
/** How video fits the player area. 'best' = keep aspect (letterbox, default); 'fill' =
 *  crop to fill the frame (mpv panscan). */
export type VideoFit = 'best' | 'fill'
export const videoFit = persisted<VideoFit>('video-fit', 'best')
/** Play in an external player (mpv/VLC/…) instead of the embedded one. No progress
 *  tracking/resume while external (we get no playback events back). */
export const enableExternalPlayer = persisted<boolean>('external-player-enabled', false)
/** Absolute path to the external player executable (e.g. C:\\Program Files\\mpv\\mpv.exe). */
export const externalPlayerPath = persisted<string>('external-player-path', '')

// --- Local history ---
/** Save watch history + progress on-device (so Continue Watching and resume work without an
 *  AniList/MyAnimeList account). On by default; can be cleared/exported in Settings → History. */
export const saveLocalHistory = persisted<boolean>('save-local-history', true)

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
/** Haptic feedback on taps/toggles/actions (Android only; desktop has no haptics engine and
 *  always no-ops regardless). Default on. */
export const haptics = persisted<boolean>('haptics', true)

/** Browse/search result layout: 'grid' (cover-art tiles, default) or 'list' (a vertical list of
 *  compact rows — small cover + title + meta, denser and text-forward). */
export type BrowseLayout = 'grid' | 'list'
export const browseLayout = persisted<BrowseLayout>('browse-layout', 'grid')

/** Desktop Schedule layout: 'agenda' (full-width day sections, default) or 'days'
 *  (day tabs + one big day). Ignored in Game mode — the Deck always shows one day. */
export type ScheduleLayout = 'agenda' | 'days'
export const scheduleLayout = persisted<ScheduleLayout>('schedule-layout', 'agenda')
// Pin the schedule header (My Shows/All toggle + Next-up strip) to the top while scrolling.
// Fresh key + platform default: on for desktop/Deck, OFF on Android — a floating pinned bar
// reads as un-native on a phone, where the header should scroll away with the list.
const scheduleStickyDefault = !(typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent))
export const scheduleStickyHeader = persisted<boolean>('schedule-sticky-header', scheduleStickyDefault)

// --- Updates ---
/** Auto-updater release channel: 'stable' (normal GitHub releases) or 'beta'
 *  (GitHub pre-releases). Drives which endpoint the updater checks. */
export const updateChannel = persisted<'stable' | 'beta'>('update-channel', 'stable')
/** Auto-check for updates at launch + every 6h. On by default; the toast is still opt-in to APPLY. */
export const autoUpdateCheck = persisted<boolean>('auto-update-check', true)

// --- Network ---
// NOTE: these are best-effort for our debrid + libmpv model (see settings copy).
/** Prefer DNS-over-HTTPS. Best-effort: our addon/AniList/mpv requests each use their
 *  own resolver, so there's no single funnel to force this through yet. */
export const enableDoH = persisted<boolean>('doh-enabled', false)
export const doHUrl = persisted<string>('doh-url', 'https://cloudflare-dns.com/dns-query')
/** Direct-torrent download limit in Mb/s. Zero means uncapped; debrid streams are unaffected. */
export const torrentDownloadLimitMbps = persisted<number>('torrent-download-limit-mbps', 0)
/** Automatic upload is a conservative 1 Mb/s. Capacity mode treats the entered value as the
 * connection's measured upstream and uses at most 70%, leaving headroom for playback ACKs. */
export const torrentUploadLimitMode = persisted<'auto' | 'capacity'>('torrent-upload-limit-mode', 'auto')
export const torrentUpstreamCapacityMbps = persisted<number>('torrent-upstream-capacity-mbps', 10)
/** Mobile post-play seeding is opt-in and additionally requires charging + an unmetered network. */
export const torrentAndroidPostSeed = persisted<boolean>('torrent-android-post-seed', false)
/** Public n0 relays are the default. Set this to an Iroh relay URL to use a self-hosted relay. */
export const syncRelayMode = persisted<'public' | 'custom'>('sync-relay-mode', 'public')
export const syncRelayUrl = persisted<string>('sync-relay-url', '')

// --- Source extensions ---
/** Which debrid service resolves extension torrent results. */
export const debridProvider = persisted<string>('debrid-provider', 'realdebrid')
/** Debrid service API token (or "user:pass" for Mega-Debrid), used to resolve
 *  extension torrent results (infoHash → cached HTTP url). Separate from any key
 *  embedded in Stremio addon URLs. Secret. */
export const debridKey = persisted<string>('debrid-key', '')
/** How infoHash/magnet sources are made playable. Direct uses Izumi's local
 * BitTorrent engine; debrid keeps the existing account-backed CDN path. */
export const torrentPlaybackMode = persisted<'debrid' | 'direct'>('torrent-playback-mode', 'debrid')
/** Installed source-extension manifest URLs (JSON manifests or gh:/npm: shorthand). */
export const extensionUrls = persisted<string[]>('extension-urls', [])
export const disabledExtensions = persisted<string[]>('disabled-extensions', [])
export const enabledExtensionUrls = derived([extensionUrls, disabledExtensions], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))

// --- Subtitle providers ---
// Direct-REST subtitle sources (OpenSubtitles / SubDL), folded into the same aggregator as the
// Stremio subtitle addons. Secrets follow the existing plain-`persisted` model, exactly like
// `debridKey` above — no new primitive. The embedded OpenSubtitles Api-Key is a build constant
// (see subtitles/opensubtitles.ts), not a store.
/** Which direct-REST subtitle providers are enabled. Default: OpenSubtitles (keyless search). */
export const subtitleProviders = persisted<string[]>('subtitle-providers', ['opensubtitles'])
/** OpenSubtitles account JWT from /login (reused until expiry). Secret. */
export const openSubtitlesToken = persisted<string>('opensubtitles-jwt', '')
/** Epoch-ms expiry of the JWT above; reuse the token until Date.now() >= this. */
export const openSubtitlesExpiry = persisted<number>('opensubtitles-jwt-exp', 0)
/** Connected OpenSubtitles username, for the connected-state display. */
export const openSubtitlesUserName = persisted<string>('opensubtitles-user', '')
/** VIP host returned by /login (base_url quirk); all subsequent calls go here when set. */
export const openSubtitlesBaseUrl = persisted<string>('opensubtitles-base', '')
/** Opt-in: store the password so izumi can silently re-login on expiry. Default off. */
export const openSubtitlesStaySignedIn = persisted<boolean>('opensubtitles-stay', false)
/** OpenSubtitles credentials, written ONLY when "Stay signed in" is on. Secret. */
export const openSubtitlesCreds = persisted<string>('opensubtitles-creds', '')
/** SubDL API key (bring-your-own; required even to search). Secret. */
export const subDlApiKey = persisted<string>('subdl-api-key', '')

/** The subtitle providers that can actually run: OpenSubtitles is always searchable (embedded
 *  Api-Key); SubDL needs a key even to search, so it's dropped when the key is empty. */
export const enabledSubtitleProviders = derived(
  [subtitleProviders, subDlApiKey],
  ([$on, $subdl]) => $on.filter((p) =>
    p === 'opensubtitles' ||
    (p === 'subdl' && !!$subdl)),
)

// --- Offline downloads ---
/** Where downloaded episodes are written. Empty = app-data/downloads (resolved in Rust). */
export const downloadDir = persisted<string>('download-dir', '')
/** Max simultaneous downloads (1–2 recommended for a debrid CDN + disk). */
export const downloadConcurrency = persisted<number>('download-concurrency', 1)
/** Bulk "Download all" only enqueues episodes with a cached source. */
export const downloadCachedOnly = persisted<boolean>('download-cached-only', true)
/** Source matching used by manual and automatic episode downloads. */
export const downloadQuality = persisted<Quality>('download-quality', '1080')
export const downloadAudio = persisted<'any' | 'sub' | 'dub'>('download-audio', 'sub')
export const downloadCodec = persisted<'any' | 'h264' | 'h265' | 'av1'>('download-codec', 'any')
/** Wait after the scheduled air time so release/indexing providers can catch up. */
export const autoDownloadDelayMinutes = persisted<number>('auto-download-delay-minutes', 15)
