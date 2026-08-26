import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
import type { StreamSort } from '$lib/stremio/addon'
import type { SourcePriorityMode } from '$lib/stremio/source-priority'
import type { P2PStatusVisibility } from '$lib/player/p2p-status'

/** How the episode list renders. Names are intentionally generic.
 *  `grid` is the dense number-tile layout — the only workable shape for a long-runner. */
export type EpisodeLayout = 'cards' | 'compact' | 'grid'

/** Persisted episode-list layout preference (default: rich cards). */
export const episodeLayout = persisted<EpisodeLayout>('episode-layout', 'cards')

/** Watchlist presentation: cover grid, detailed rows, or dense one-line rows. */
export type WatchlistLayout = 'cards' | 'list' | 'compact'
export const watchlistLayout = persisted<WatchlistLayout>('watchlist-layout', 'cards')

/** Watchlist ordering. `behind` is the default aired-but-unwatched-first sort. */
export type WatchlistSort = 'behind' | 'updated' | 'title' | 'next'
export const watchlistSort = persisted<WatchlistSort>('watchlist-sort', 'behind')


/** What removing a series from Continue Watching (press D on a card) also does to the tracker.
 *  'none' = just hide it from the row (default). */
export type CwDismissAction = 'none' | 'paused' | 'dropped'
export const cwDismissAction = persisted<CwDismissAction>('cw-dismiss-action', 'none')

/** Which title to show for anime across the app (see `title()` in anilist/media). */
export type TitleLanguage = 'romaji' | 'english'
/** Persisted title-language preference (default: Romaji). */
export const titleLanguage = persisted<TitleLanguage>('title-language', 'romaji')

/** Game-mode player: place the now-playing title at the TOP of the player. This is the default;
 *  the toggle remains available for people who prefer it above the seek bar. */
if (typeof localStorage !== 'undefined' && localStorage.getItem('player-title-top-default-r2') == null) {
  // The old default was persisted as `false`, so changing only the fallback would leave every
  // existing Deck at the bottom forever. Migrate once; subsequent user toggles remain respected.
  localStorage.setItem('player-title-top', 'true')
  localStorage.setItem('player-title-top-default-r2', 'true')
}
export const playerTitleTop = persisted<boolean>('player-title-top', true)

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

// --- Subtitle presentation + synchronization ---
/** Apply Izumi's subtitle appearance instead of leaving styling entirely to the subtitle file. */
export const subtitleStyleEnabled = persisted<boolean>('subtitle-style-enabled', false)
/** Keep ASS signs/typesetting intact where possible, or deliberately restyle every subtitle element. */
export type SubtitleOverrideScope = 'dialogue' | 'all'
export const subtitleOverrideScope = persisted<SubtitleOverrideScope>('subtitle-override-scope', 'dialogue')
export const subtitleFont = persisted<string>('subtitle-font', 'Nunito')
export const subtitleBold = persisted<boolean>('subtitle-bold', false)
export const subtitleFontSize = persisted<number>('subtitle-font-size', 42)
export const subtitleTextColor = persisted<string>('subtitle-text-color', '#ffffff')
export const subtitleBorderColor = persisted<string>('subtitle-border-color', '#000000')
export const subtitleBorderSize = persisted<number>('subtitle-border-size', 3)
export const subtitleShadow = persisted<number>('subtitle-shadow', 1)
/** mpv's vertical subtitle position: 0 is top and 100 is bottom. */
export const subtitlePosition = persisted<number>('subtitle-position', 92)
/** Analyze speech with ffmpeg and align external text subtitles when a track is selected. */
export const subtitleAutoSync = persisted<boolean>('subtitle-auto-sync', false)
/** Show a second subtitle track through mpv's secondary-sid support. */
export const secondarySubtitles = persisted<boolean>('subtitle-secondary-enabled', false)
/** Remove hearing-impaired annotations such as [door closes] from rendered subtitles. */
export const subtitleStripSdh = persisted<boolean>('subtitle-strip-sdh', false)
export const subtitleStripSdhHarder = persisted<boolean>('subtitle-strip-sdh-harder', false)
/** Optional mpv subtitle regex filter. Empty leaves subtitle text untouched. */
export const subtitleRegexFilter = persisted<string>('subtitle-regex-filter', '')

// --- Source extension filtering ---
/** Content languages (ISO 639-1, as declared by each provider's manifest) worth querying.
 *  EMPTY MEANS ALL — the reference app models the same idea with a "universal" sentinel. Filtering
 *  here is both a relevance and a speed control: a skipped provider is never queried at all, and a
 *  typical catalog is half non-English. */
export const providerLanguages = persisted<string[]>('provider-languages', [])
/** Which audio flavours to resolve from source extensions. 'both' offers each title's dub and sub
 *  side by side; the others halve the work as well as the noise. */
export type ProviderAudio = 'both' | 'sub' | 'dub'
export const providerAudio = persisted<ProviderAudio>('provider-audio', 'both')

// --- Source selection ---
/** Auto-play the best cached source: when the source list settles, count down ~5s (the Auto
 *  button fills left→right) then play the best match at (or near) the preferred quality. Cancel
 *  by picking another source or interacting. Default ON — turn off to always choose manually.
 *  (Fresh `autoplay-best` key so the new default reliably reaches existing installs.) */
export const autoSelectSource = persisted<boolean>('autoplay-best', true)
/** Grace period before the auto-pick fires: true = count down ~5s so you can cancel, false = play
 *  the best match immediately (the default). Storage key kept from when this toggle was
 *  animation-only, so an existing explicit preference carries over. The filling bar is motion and
 *  is suppressed under reduced motion; the wait itself still applies (the numeric readout keeps
 *  counting). */
export const autoSelectCountdown = persisted<boolean>('auto-select-animate', false)
export type Quality = '2160' | '1080' | '720' | '480' | 'any'
export const preferredQuality = persisted<Quality>('preferred-quality', '1080')
/** Origin ids the user trusts, most-trusted first. Empty = no opinion, which is the default: the
 *  existing heuristics already rank well, and a preference nobody stated should not be invented. */
export const sourcePriority = persisted<string[]>('source-priority', [])
/** `prefer` ranks the trusted sources first but still uses the others; `strict` uses ONLY them and
 *  reports an empty result rather than quietly playing a source that was excluded on purpose. */
export const sourcePriorityMode = persisted<SourcePriorityMode>('source-priority-mode', 'prefer')
/** How Continue Watching uses recent source memory. `resumed` is episode-specific and only applies
 * when that episode has saved progress; `always` applies the title's latest source to new episodes. */
export type ContinueSourcePreference = 'resumed' | 'always' | 'never'
export const continueSourcePreference = persisted<ContinueSourcePreference>('continue-source-preference', 'resumed')

// --- Source picker ---
/** Show dead/down sources (uncached torrents with no seeders) in the picker.
 *  Off = hidden (they always sink to the bottom and are never auto-played). */
export const showDeadSources = persisted<boolean>('show-dead-sources', false)
/** Show an addon's whole description on a source row instead of clamping it. Addons write real
 *  detail into that text — tracker, languages, per-file notes — and clamping is a default, not a
 *  decision that any of it was worth discarding. */
export const fullStreamDescription = persisted<boolean>('full-stream-description', false)
/** Within-cache-tier sort order for the source picker. */
export const preferredStreamSort = persisted<StreamSort>('preferred-stream-sort', 'quality')
/** Mark sources a curated release database recommends, and prefer them within a quality tier.
 *  Default on: it adds no source and sends no identity, it only annotates rows the picker already
 *  found, and it costs one heavily cached request per title. Off stops the lookup entirely. */
export const seadexAnnotations = persisted<boolean>('seadex-annotations', true)

// --- Player behaviour ---
/** Compact transfer/peer status shown over local P2P playback. The default only covers the wait
 * for the first rendered frame; debrid playback never displays it. */
export const p2pStatusVisibility = persisted<P2PStatusVisibility>('player-p2p-status-visibility', 'initial')
/** Auto-play the next episode when one finishes. Default on. */
export const autoplayNext = persisted<boolean>('player-autoplay-next', true)
/** Binge next episode: keep the SAME release across episodes (Stremio bingeGroup) so
 *  the next one doesn't re-pick a source, and pre-resolve + warm-buffer it as the
 *  current episode nears the end so Next/auto-advance starts instantly. Default on. */
export const bingePreload = persisted<boolean>('player-binge-preload', true)
/** Seconds the -N/+N buttons and arrow keys seek. */
export const seekDuration = persisted<number>('player-seek-seconds', 10)
/** Show controls that seek playback to the previous, current, or next subtitle cue. */
export const subtitleLineNavigation = persisted<boolean>('player-subtitle-line-navigation', false)
/** Show the frame-preview thumbnail while skimming the seek bar. Off = time/chapter only
 *  (also skips the on-demand frame grab — lighter on the Deck iGPU). */
export const scrubThumbnails = persisted<boolean>('player-scrub-thumbnails', true)
/** Animate Game-mode player chrome as the progress controls appear/disappear. Default on. */
export const playerProgressAnimations = persisted<boolean>('player-progress-animations', true)
/** Burn the currently displayed subtitle track into frames captured for GIF recordings. */
export const gifIncludeSubtitles = persisted<boolean>('player-gif-include-subtitles', false)
/** Output width in CSS pixels; height follows the video aspect. 720px fits most upload caps. */
export const gifScale = persisted<number>('player-gif-scale', 720)
/** Stop recording after this many seconds. 10s is the sharing sweet spot; 30s is the ceiling. */
export const gifMaxSeconds = persisted<number>('player-gif-max-seconds', 10)
/** Android: leaving the app (home / recents) while a video is playing shrinks it into the
 *  miniplayer instead of stopping, the way every mobile video app behaves. Default on; turn it off
 *  to keep the episode on the watch page and just leave. */
export const androidAutoPip = persisted<boolean>('android-auto-pip', true)
/** Keep the screen awake (no dim/sleep) while a video is playing — fixes the Steam Deck
 *  turning the screen off mid-episode. Released when paused / stopped, so battery-saver still
 *  kicks in when you're not watching. Default on. */
export const keepAwakeWhilePlaying = persisted<boolean>('player-keep-awake', true)
/** Publish playback metadata/actions to MPRIS (Linux) and SMTC (Windows). On by default, so adult
 *  titles publish a placeholder name and no artwork — the transport controls stay live. */
export const systemMediaControls = persisted<boolean>('system-media-controls', true)
/** Discord activity is on by default and can be disabled at any time. Adult titles are always
 *  suppressed before reaching native IPC. */
export const discordRichPresence = persisted<boolean>('discord-rich-presence', true)
/** After ~90s of real playback, move a PLANNING (or unlisted) title to Watching. Off until the user opts in. */
export const promoteToWatching = persisted<boolean>('tracker-promote-on-play', false)
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

/** Video-quality preset: a bundle of mpv render options (scalers, debanding, dithering, …)
 *  applied together. 'custom' hands control to the raw-options textarea below. See
 *  `resolvePreset` in $lib/player/quality for the actual option table. */
export type QualityPreset = 'performance' | 'standard' | 'high' | 'anime' | 'custom'
export const videoQualityPreset = persisted<QualityPreset>('video-quality-preset', 'standard')
/** Raw mpv render options (one `key=value` per line) for the Custom preset. */
export const rawMpvOptions = persisted<string>('video-raw-mpv-options', '')
export type AudioProcessing = 'off' | 'dialogue' | 'night' | 'boost'
export const audioProcessing = persisted<AudioProcessing>('player-audio-processing', 'off')
export type WindowsVsr = 'off' | 'nvidia' | 'intel'
export const windowsVsr = persisted<WindowsVsr>('player-windows-vsr', 'off')
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
/** Label episodes with the series-wide (absolute) number instead of the per-season one, where the
 *  two differ. Display only — every other part of the app keeps using the per-season number. Off by
 *  default: the numbering choice used to sit on the series page itself, where it was just clutter. */
export const absoluteEpisodeNumbers = persisted<boolean>('absolute-episode-numbers', false)
/** Let horizontal mouse-wheel/trackpad gestures scroll carousel rows. Vertical input always
 *  remains page scrolling. Off by default: use the row's ‹ › arrow buttons instead. */
export const wheelScrollAcross = persisted<boolean>('carousel-wheel-scroll', false)
/** Allow a held primary mouse button to drag carousel rows and step the featured banner.
 *  Kept on by default because row dragging was the established desktop behaviour before this
 *  became configurable. Touch swipes remain available independently on mobile. */
export const dragCarousels = persisted<boolean>('carousel-mouse-drag', true)
/** WebView zoom factor for the whole UI (0.5–2.0). */
export const uiScale = persisted<number>('ui-scale', 1)
/** Include 18+ / adult titles in browse + search (AniList isAdult filter). */
export const showAdult = persisted<boolean>('show-adult', false)
/** Auto-enter incognito whenever an adult (isAdult) title starts playing, and leave it (purging
 *  the session overlay) when playback closes — unless incognito was already on manually. */
export const autoIncognitoAdult = persisted<boolean>('auto-incognito-adult', false)
/** Haptic feedback on taps/toggles/actions (Android only; desktop has no haptics engine and
 *  always no-ops regardless). Default on. */
export const haptics = persisted<boolean>('haptics', true)
/** Forward verbose frontend + native/JVM diagnostics to desktop DevTools. Opt-in because provider
 * logs and Network/Console inspection may expose signed URLs or account material. */
export const developerLogging = persisted<boolean>('developer-logging', false)
/** User overrides for keyboard shortcuts. Missing actions fall back to their shipped defaults. */
export const hotkeyBindings = persisted<Record<string, string>>('hotkey-bindings', {})
export const DEFAULT_HOME_ROWS = [
  'continue', 'recent', 'list', 'recommendations', 'season', 'trending', 'popular', 'romance', 'action', 'fantasy',
] as const
export type HomeRowId = (typeof DEFAULT_HOME_ROWS)[number]
/** Home carousel order and visibility. Unknown/new rows are appended by the normalizer on render. */
export const homeRowOrder = persisted<string[]>('home-row-order', [...DEFAULT_HOME_ROWS])
export const hiddenHomeRows = persisted<string[]>('home-row-hidden', [])
/** AniList media IDs explicitly hidden from Recently Released with the desktop D shortcut. */
export const dismissedRecentReleaseIds = persisted<number[]>('home-recent-dismissed', [])
// Recently Released is useful but network-backed and intentionally opt-in. A one-time migration is
// required as well as the empty-store default: otherwise every existing install would see a newly
// appended row merely because the normalizer learned its id.
if (typeof localStorage !== 'undefined' && localStorage.getItem('home-recent-row-default-v1') == null) {
  hiddenHomeRows.update((rows) => rows.includes('recent') ? rows : [...rows, 'recent'])
  localStorage.setItem('home-recent-row-default-v1', 'hidden')
}

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
/** Which tab the Schedule page opens on: the weekly airing 'schedule' (default) or
 *  'watchlist' — the viewer's watching list ordered by aired-but-unwatched episodes. */
export type ScheduleTab = 'schedule' | 'watchlist'
export const scheduleDefaultTab = persisted<ScheduleTab>('schedule-default-tab', 'schedule')
/** Show the "Next up" strip at the top of the schedule. Off means the grid starts immediately. */
export const scheduleShowNextUp = persisted<boolean>('schedule-show-next-up', true)

// --- Updates ---
/** Auto-updater release channel: 'stable' (normal GitHub releases) or 'beta'
 *  (GitHub pre-releases). Drives which endpoint the updater checks. */
export const updateChannel = persisted<'stable' | 'beta'>('update-channel', 'stable')
// There is deliberately no "auto-check" toggle: checking is always on (launch + every 6h) so
// nobody sits on a stale client. Applying an update is still opt-in — the toast asks first.

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
/** Optional SOCKS5 tunnel for Direct P2P. Native playback treats this as a kill-switch mode:
 * peer TCP and HTTP trackers use the proxy, while direct-only DHT/UDP trackers are disabled. */
export const torrentProxyEnabled = persisted<boolean>('torrent-proxy-enabled', false)
export const torrentProxyUrl = persisted<string>('torrent-proxy-url', 'socks5://127.0.0.1:1080')
/** qBittorrent-style adapter binding for Direct P2P: the OS name of the network interface
 * (usually the VPN's virtual adapter) torrenting is tied to. Empty = any interface. The native
 * engine refuses to start without the adapter and pauses every torrent the moment it drops. */
export const torrentBindInterface = persisted<string>('torrent-bind-interface', '')
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
/** Dismisses the "hosting a room streams your debrid link from every guest's IP" warning shown
 *  before a room is created. Off by default so the warning is seen at least once. */
export const debridRoomNoticeAck = persisted<boolean>('debrid-room-notice-ack', false)
/** Installed source-extension manifest URLs (JSON manifests or gh:/npm: shorthand). */
export const extensionUrls = persisted<string[]>('extension-urls', [])
export const disabledExtensions = persisted<string[]>('disabled-extensions', [])
export const enabledExtensionUrls = derived([extensionUrls, disabledExtensions], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))
/** Individually switched-off plugins WITHIN an enabled source, by extension id.
 *
 *  One URL expands to many plugins — a marketplace index is a single entry that yields ~18 — so a
 *  per-URL toggle is all-or-nothing. This is the per-plugin switch, matching how the reference app
 *  separates "add a repository" from "enable the plugins in it".
 *
 *  Stored as an OPT-OUT list so an existing setup keeps working and a newly published plugin
 *  appears by default; an opt-in list would silently switch off everything already configured. */
export const disabledPlugins = persisted<string[]>('disabled-plugins', [])

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
/** Jimaku API key (bring-your-own; every endpoint is authenticated). Secret. */
export const jimakuApiKey = persisted<string>('jimaku-api-key', '')

/** The subtitle providers that can actually run: OpenSubtitles is always searchable (embedded
 *  Api-Key); SubDL and Jimaku need a key even to search, so they're dropped when the key is empty. */
export const enabledSubtitleProviders = derived(
  [subtitleProviders, subDlApiKey, jimakuApiKey],
  ([$on, $subdl, $jimaku]) => $on.filter((p) =>
    p === 'opensubtitles' ||
    (p === 'subdl' && !!$subdl) ||
    (p === 'jimaku' && !!$jimaku)),
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

/** Opt-in native notifications for upcoming episodes. Permission is requested only from the
 * explicit settings action; boot never prompts. */
export const airingNotifications = persisted<boolean>('airing-notifications', false)
export const airingNotificationLeadMinutes = persisted<number>('airing-notification-lead-minutes', 0)
export const scheduledAiringNotificationIds = persisted<number[]>('scheduled-airing-notification-ids', [])

export type ThemePreset = 'izumi' | 'midnight' | 'sakura' | 'ocean' | 'light' | 'system'
export type MotionPreference = 'system' | 'reduce' | 'full'
export const themePreset = persisted<ThemePreset>('theme-preset', 'izumi')
export const motionPreference = persisted<MotionPreference>('motion-preference', 'system')
export const highContrast = persisted<boolean>('high-contrast', false)
export const largeInteractionTargets = persisted<boolean>('large-interaction-targets', false)
