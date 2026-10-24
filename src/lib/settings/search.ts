import type { SettingsSectionId } from './sections'

/** A hit is hidden where its row is not shown: on the phone layout (`phone`, `$isMobile`), on
 *  Android TV (`tv`), on a build without the in-app player (`lite`, `!$inAppPlayerAvailable`) or in
 *  Steam Deck Game mode (`gamemode`, where the controller layout leaves the row out). */
export type SettingHideOn = 'phone' | 'tv' | 'lite' | 'gamemode'

export type SettingSearchItem = {
  title: string
  /** The title of the row's section (sections.ts), shown beside the hit. */
  category: string
  /** The route that renders the row: its section page or a sub-page. A row whose old page still
   *  renders inside another section page opens that page until the row moves; a hit with no `key`
   *  adds the `#id` of the block that renders it there, so it opens on that block. */
  href: string
  description?: string
  keywords?: string
  /** The row's `data-setting-key`. The hit scrolls to it, tints it and, on a pad or TV, focuses its
   *  safe control (search-target.ts). search-anchors.test.ts checks the destination renders it. */
  key?: string
  /** Revealed instead when `key` is not rendered on this device or build (usually its group). */
  fallbackKey?: string
  desktopOnly?: boolean
  androidOnly?: boolean
  hideOn?: ReadonlyArray<SettingHideOn>
  /** The section the row belongs to, and the subcategory of it that holds the row (sections.ts). */
  section: SettingsSectionId
  subcategory: string
  /** The row sits in the section's folded Advanced subcategory. */
  advanced?: true
}

/** What this device shows. A bare boolean passed to searchSettings means `{ android }`. */
export interface SettingsSearchEnv { android: boolean; phone?: boolean; tv?: boolean; lite?: boolean; gamemode?: boolean }

/** URL parameters a hit adds to its href; the settings layout hands them to revealSetting. */
export const SETTING_PARAM = 'setting'
export const SETTING_FALLBACK_PARAM = 'settingFallback'

export const settingKey = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export const SETTINGS_SEARCH_INDEX: SettingSearchItem[] = [
  { title: 'Profiles and parental PINs', category: 'Accounts and profiles', href: '/app/settings/profiles', keywords: 'household kids children age rating adult lock switch user', section: 'accounts', subcategory: 'profiles' },
  { title: 'Audio processing', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', key: 'audio-processing', keywords: 'night mode dialogue boost volume loudnorm compressor limiter', hideOn: ['lite'] },
  { title: 'Rendering preset', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', key: 'rendering-preset', keywords: 'video quality mpv scale deband high performance standard anime custom ewa', hideOn: ['lite'] },
  { title: 'Audio language', category: 'Languages', section: 'languages', subcategory: 'playback', href: '/app/settings/languages', key: 'audio-language', keywords: 'Japanese English dub' },
  { title: 'Subtitle language', category: 'Languages', section: 'languages', subcategory: 'playback', href: '/app/settings/languages', key: 'subtitle-language', keywords: 'captions default language off' },
  { title: 'P2P playback status', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', key: 'p2p-playback-status', keywords: 'torrent download upload speed peers buffering initial always hidden direct', hideOn: ['lite'] },
  { title: 'Auto-play next episode', category: 'Playback', section: 'playback', subcategory: 'up-next', href: '/app/settings/playback', key: 'auto-play-next-episode', hideOn: ['lite'] },
  { title: 'Show Up Next countdown', category: 'Playback', section: 'playback', subcategory: 'up-next', href: '/app/settings/playback', keywords: 'up next overlay card next episode end credits', key: 'show-up-next-countdown', hideOn: ['lite'] },
  { title: 'Miniplayer when you leave the app', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', keywords: 'picture in picture pip floating video home recents', key: 'miniplayer-when-you-leave-the-app', androidOnly: true, hideOn: ['tv', 'lite'] },
  { title: 'Discord Rich Presence', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', keywords: 'discord rpc activity status sharing privacy', key: 'discord-rich-presence', desktopOnly: true },
  { title: 'Keep screen awake while playing', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', keywords: 'sleep dim battery', key: 'keep-screen-awake-while-playing', hideOn: ['lite'] },
  { title: 'Binge next episode (preload)', category: 'Playback', section: 'playback', subcategory: 'up-next', href: '/app/settings/playback', keywords: 'buffer instant next auto advance', key: 'binge-next-episode-preload', hideOn: ['lite'] },
  { title: 'Auto-skip openings & endings', category: 'Playback', section: 'playback', subcategory: 'skipping', href: '/app/settings/playback', keywords: 'op ed intro outro recap chapters skip times', key: 'auto-skip-openings-endings', hideOn: ['lite'] },
  { title: 'Auto-skip next-episode previews', category: 'Playback', section: 'playback', subcategory: 'skipping', href: '/app/settings/playback', keywords: 'preview next episode trailer chapters', key: 'auto-skip-next-episode-previews', hideOn: ['lite'] },
  { title: 'Skip filler episodes', category: 'Playback', section: 'playback', subcategory: 'skipping', href: '/app/settings/playback', key: 'skip-filler-episodes', hideOn: ['lite'] },
  { title: 'Scrub preview thumbnails', category: 'Playback', section: 'playback', subcategory: 'seeking', href: '/app/settings/playback', keywords: 'seek frame preview', key: 'scrub-preview-thumbnails', hideOn: ['lite'] },
  { title: 'Animate player progress controls', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'animation motion fade smooth controls seek bar progress Steam Deck Game mode VacuumTube', key: 'animate-player-progress-controls', desktopOnly: true },
  { title: 'Subtitle line navigation', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'captions previous replay next cue language learning', key: 'subtitle-line-navigation', desktopOnly: true },
  { title: 'Hide sidebar while playing', category: 'Playback', href: '/app/settings/playback', keywords: 'navigation rail full width video windowed theater', key: 'hide-sidebar-while-playing', desktopOnly: true, section: 'playback', subcategory: 'player-window' },
  { title: 'GIF recorder', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', keywords: 'gif capture record width quality anime screenshot', key: 'gif-recorder', desktopOnly: true },
  { title: 'Include subtitles in GIFs', category: 'Playback', section: 'playback', subcategory: 'player-window', href: '/app/settings/playback', keywords: 'gif capture record captions burn in', key: 'include-subtitles-in-gifs', fallbackKey: 'gif-recorder', hideOn: ['lite'] },
  { title: 'Player cache size', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', key: 'player-cache-size', keywords: 'buffer ram memory', desktopOnly: true },
  { title: 'Seek duration', category: 'Playback', section: 'playback', subcategory: 'seeking', href: '/app/settings/playback', key: 'seek-duration', keywords: 'skip seconds arrows double tap', hideOn: ['lite'] },
  { title: 'Enable external player', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'mpv vlc', key: 'enable-external-player', desktopOnly: true },
  { title: 'Home-theatre audio', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', key: 'home-theatre-audio', keywords: 'atmos dts passthrough receiver hdmi earc optical spdif dolby digital truehd surround', hideOn: ['lite'] },
  { title: 'Dolby Vision source handling', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', key: 'dolby-vision-source-handling', keywords: 'hdr hdr10 sdr tone map display output target', hideOn: ['lite'] },
  { title: 'Rating style', category: 'Home and library', href: '/app/settings/appearance', keywords: 'score vote rate my rating stars bar numbers 1-10 dropdown menu descriptor appearance', key: 'rating-style', section: 'library', subcategory: 'ratings' },
  { title: 'Show rating on the series page', category: 'Home and library', href: '/app/settings/appearance', keywords: 'score vote your rating hide hidden always once rated series page', key: 'show-rating-on-the-series-page', section: 'library', subcategory: 'ratings' },
  { title: 'Ask for a rating when a series ends', category: 'Playback', section: 'playback', subcategory: 'up-next', href: '/app/settings/playback', keywords: 'score vote rate finale finished prompt end of series', key: 'ask-for-a-rating-when-a-series-ends' },
  { title: 'Title language', category: 'Languages', section: 'languages', subcategory: 'app', href: '/app/settings/languages', key: 'title-language', keywords: 'romaji English anime names' },
  { title: 'Episode queue', category: 'Home and library', href: '/app/settings/appearance', keywords: 'watch next ordered list queue episode optional', key: 'episode-queue', section: 'library', subcategory: 'features' },
  { title: 'Scene bookmarks', category: 'Home and library', href: '/app/settings/appearance', keywords: 'saved moments quote notes timestamp resume keep scene optional', key: 'scene-bookmarks', section: 'library', subcategory: 'scenes' },
  { title: 'Title at top of player (Game mode)', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'Steam Deck now playing', key: 'title-at-top-of-player-game-mode', desktopOnly: true },

  { title: 'Use custom subtitle style', category: 'Subtitles', section: 'subtitles', subcategory: 'appearance', href: '/app/settings/subtitles', keywords: 'appearance font family size colour color border outline shadow position nunito', key: 'use-custom-subtitle-style' },
  { title: 'Subtitle dialogue style overrides', category: 'Subtitles', section: 'subtitles', subcategory: 'advanced', advanced: true, href: '/app/settings/subtitles', keywords: 'ASS signs songs karaoke typesetting preserve font readable dialogue only all elements', key: 'subtitle-dialogue-style-overrides', fallbackKey: 'use-custom-subtitle-style' },
  { title: 'OpenSubtitles', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'provider captions', key: 'opensubtitles' },
  { title: 'SubDL', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'provider captions api key', key: 'subdl' },
  { title: 'OpenSubtitles account', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'login username password quota', key: 'opensubtitles' },
  { title: 'Stay signed in', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'remember login', key: 'opensubtitles' },
  { title: 'SubDL API key', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'token provider', key: 'subdl' },
  { title: 'Jimaku', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'provider captions api key japanese', key: 'jimaku' },
  { title: 'Jimaku API key', category: 'Subtitles', section: 'subtitles', subcategory: 'providers', href: '/app/settings/subtitles', keywords: 'token provider japanese', key: 'jimaku' },

  { title: 'Default catalog platform', category: 'Home and library', href: '/app/settings/library', keywords: 'startup home provider anilist kitsu tmdb stremio jvm aniyomi automatic', key: 'default-catalog-platform', section: 'library', subcategory: 'home' },
  { title: 'Continue Watching', category: 'Home and library', href: '/app/settings/library', keywords: 'history progress current platform provider all combined separate scope', key: 'continue-watching', section: 'library', subcategory: 'home' },
  { title: 'Catalog platforms', category: 'Home and library', href: '/app/settings/library', keywords: 'enable provider logo cycle switch anilist kitsu tmdb stremio jvm aniyomi automatic adaptive last selected default startup', key: 'catalog-platform-auto', section: 'library', subcategory: 'home' },
  { title: 'Aniyomi sources', category: 'Home and library', href: '/app/settings/library', keywords: 'aniyomi extension provider popular latest browse filter', section: 'library', subcategory: 'advanced', advanced: true },
  { title: 'TMDB read access token', category: 'Accounts and profiles', href: '/app/settings/library', keywords: 'tmdb api key credential token movies television', key: 'tmdb-token', fallbackKey: 'catalog-platform-tmdb', section: 'accounts', subcategory: 'keys' },
  { title: 'OMDb API key', category: 'Accounts and profiles', href: '/app/settings/library', keywords: 'omdb rotten tomatoes metacritic imdb critic review ratings credential', key: 'omdb-key', fallbackKey: 'catalog-platform-tmdb', section: 'accounts', subcategory: 'keys' },
  { title: 'Nuvio account and community', category: 'Home and library', href: '/app/nuvio', keywords: 'login sign in signup connect device code collections packs covers artwork profiles browse search cloud library history progress resume sources preferences import export transfer', section: 'library', subcategory: 'home' },
  { title: 'Collections and covers', category: 'Home and library', href: '/app/settings/library/collections', section: 'library', subcategory: 'home', keywords: 'nuvio import json folders home artwork edit' },
  { title: 'Customize Home', category: 'Home and library', href: '/app/settings/library/home', section: 'library', subcategory: 'home', keywords: 'home rows sections order hide reorder layout' },

  { title: 'Auto-play the best source', category: 'Playback', section: 'playback', subcategory: 'quality', href: '/app/settings/playback', keywords: 'automatic stream cached countdown timer instant', key: 'auto-play-the-best-source' },
  { title: 'Preferred quality', category: 'Playback', section: 'playback', subcategory: 'quality', href: '/app/settings/playback', key: 'preferred-quality', fallbackKey: 'auto-play-the-best-source', keywords: '4k 1080p 720p resolution' },
  { title: 'Adaptive source planner', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'learn local reliability preview shadow agent automatic ranking', key: 'adaptive-source-planner' },
  { title: 'Stremio addon sources', category: 'Sources and store', href: '/app/settings/sources?tab=manage', keywords: 'manifest url torrent debrid', section: 'sources', subcategory: 'my-sources' },
  { title: 'Mark best releases', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'seadex releases.moe curated encode quality badge recommended', key: 'mark-best-releases' },
  { title: 'Source priority', category: 'Sources and store', href: '/app/settings/sources/priority', keywords: 'order trust prefer strict addon extension provider first reorder', section: 'sources', subcategory: 'priority' },
  { title: 'Default discussion source', category: 'Sources and store', href: '/app/settings/sources?tab=ordering', keywords: 'comments reddit anilist mal youtube disqus forum', key: 'default-discussion-source', section: 'sources', subcategory: 'discussion' },

  { title: 'Debrid provider', category: 'Sources and store', href: '/app/settings/sources?tab=playback', keywords: 'Real-Debrid AllDebrid Premiumize TorBox', section: 'sources', subcategory: 'debrid' },
  { title: 'Debrid token', category: 'Accounts and profiles', href: '/app/settings/sources?tab=playback', keywords: 'api key credential password', section: 'accounts', subcategory: 'keys' },
  { title: 'Torrent playback', category: 'Sources and store', href: '/app/settings/sources?tab=playback', keywords: 'magnet direct p2p peer debrid', section: 'sources', subcategory: 'debrid' },
  { title: 'Source repositories', category: 'Sources and store', href: '/app/settings/sources?tab=manage', keywords: 'extension manifest github url plugins community', section: 'sources', subcategory: 'advanced', advanced: true },

  { title: 'Offline mode', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'no network local', key: 'offline-mode', section: 'downloads', subcategory: 'offline' },
  { title: 'Download folder', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'directory path storage location', section: 'downloads', subcategory: 'folder' },
  { title: 'Simultaneous downloads', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'concurrent concurrency number', section: 'downloads', subcategory: 'advanced', advanced: true },
  { title: 'Only download cached sources', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'instant debrid', key: 'only-download-cached-sources', section: 'downloads', subcategory: 'advanced', advanced: true },
  { title: 'Download quality', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'automatic offline release matching', section: 'downloads', subcategory: 'folder' },
  { title: 'Download audio', category: 'Languages', section: 'languages', subcategory: 'downloads', href: '/app/settings/languages', key: 'download-audio', keywords: 'sub dub release matching' },
  { title: 'Download codec', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'h264 h265 hevc av1 release matching', section: 'downloads', subcategory: 'advanced', advanced: true },
  { title: 'Automatic downloads', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'new episode subscription airing schedule', section: 'downloads', subcategory: 'folder' },
  { title: 'Episode airing notifications', category: 'Home and library', href: '/app/settings/appearance', keywords: 'notify alert schedule new episode', key: 'episode-airing-notifications', section: 'library', subcategory: 'notifications' },
  { title: 'Theme and accessibility', category: 'Appearance', href: '/app/settings/appearance', keywords: 'light dark contrast motion focus wcag large targets', section: 'appearance', subcategory: 'accessibility' },
  { title: 'Storage used', category: 'Downloads and storage', href: '/app/settings/downloads', keywords: 'disk space size', section: 'downloads', subcategory: 'storage' },
  { title: 'Saved scenes', category: 'Home and library', href: '/app/settings/library#scenes', keywords: 'scene bookmarks quotes notes timestamps resume manage', section: 'library', subcategory: 'scenes' },

  { title: 'Cache sizes', category: 'Downloads and storage', href: '/app/settings/downloads#storage', keywords: 'disk space used free cleanup hoarding', section: 'downloads', subcategory: 'storage' },
  { title: 'Scrub previews cache', category: 'Downloads and storage', href: '/app/settings/downloads#storage', keywords: 'thumbnails seek bar hover tiles clear', section: 'downloads', subcategory: 'storage' },
  { title: 'Direct P2P playback cache', category: 'Downloads and storage', href: '/app/settings/downloads#storage', keywords: 'torrent pieces streaming clear space', section: 'downloads', subcategory: 'storage' },
  { title: 'Downloaded subtitles cache', category: 'Downloads and storage', href: '/app/settings/downloads#storage', keywords: 'opensubtitles subdl jimaku srt clear', section: 'downloads', subcategory: 'storage' },
  { title: 'Clear all caches', category: 'Downloads and storage', href: '/app/settings/downloads#storage', keywords: 'free disk space delete cleanup', section: 'downloads', subcategory: 'storage' },

  { title: 'Haptics', category: 'Appearance', href: '/app/settings/appearance', keywords: 'vibration feedback Android', key: 'haptics', section: 'appearance', subcategory: 'accessibility' },
  { title: 'Theme Studio', category: 'Appearance', href: '/app/settings/theme-studio', keywords: 'custom theme colours palette typography font radius backdrop contrast import export appearance', section: 'appearance', subcategory: 'theme' },
  { title: 'Themes', category: 'Appearance', href: '/app/settings/themes', keywords: 'theme catalog gallery browse install link file folder community appearance layout izumi-themes', section: 'appearance', subcategory: 'theme' },
  { title: 'Episode list layout', category: 'Home and library', href: '/app/settings/appearance', keywords: 'cards compact', section: 'library', subcategory: 'layouts' },
  { title: 'Series-wide episode numbers', category: 'Home and library', href: '/app/settings/appearance', keywords: 'absolute numbering season episode number continuous count', key: 'series-wide-episode-numbers', section: 'library', subcategory: 'advanced', advanced: true },
  { title: 'Browse layout', category: 'Home and library', href: '/app/settings/appearance', keywords: 'grid list covers', section: 'library', subcategory: 'layouts' },
  { title: 'Schedule layout', category: 'Home and library', href: '/app/settings/appearance', keywords: 'agenda days', section: 'library', subcategory: 'layouts' },
  { title: 'Pin schedule header', category: 'Home and library', href: '/app/settings/appearance', keywords: 'sticky', key: 'pin-schedule-header', section: 'library', subcategory: 'advanced', advanced: true },
  { title: 'Show "Next up" on the schedule', category: 'Home and library', href: '/app/settings/appearance', keywords: 'airing now countdown strip hide', key: 'show-next-up-on-the-schedule', section: 'library', subcategory: 'layouts' },
  { title: 'Remove from Continue Watching', category: 'Home and library', href: '/app/settings/appearance', keywords: 'dismiss dropped paused on hold', section: 'library', subcategory: 'history' },
  { title: 'UI scale', category: 'Appearance', href: '/app/settings/appearance', keywords: 'zoom size accessibility', key: 'ui-scale', hideOn: ['phone'], section: 'appearance', subcategory: 'accessibility' },
  { title: 'App language', category: 'Languages', section: 'languages', subcategory: 'app', href: '/app/settings/languages', key: 'app-language', keywords: 'language locale translation japanese english interface' },
  { title: 'Android TV layout', category: 'Appearance', href: '/app/settings/appearance', keywords: 'television remote dpad leanback ten foot focus wide couch', key: 'android-tv-layout', androidOnly: true, section: 'appearance', subcategory: 'tv' },
  { title: 'Hide spoilers', category: 'Home and library', href: '/app/settings/appearance', keywords: 'blur episode thumbnails titles ratings', key: 'hide-spoilers', section: 'library', subcategory: 'ratings' },
  { title: 'Show 18+ content', category: 'Accounts and profiles', href: '/app/settings/appearance', keywords: 'adult nsfw mature', key: 'show-18-content', section: 'accounts', subcategory: 'content' },
  { title: 'Incognito for 18+ titles', category: 'Accounts and profiles', href: '/app/settings/appearance', keywords: 'adult nsfw private auto incognito ghost secret no sync', key: 'incognito-for-18-titles', section: 'accounts', subcategory: 'content' },
  { title: 'Wheel-scroll carousels', category: 'Appearance', href: '/app/settings/appearance', keywords: 'mouse horizontal home rows', key: 'wheel-scroll-carousels', section: 'appearance', subcategory: 'advanced', advanced: true },

  { title: 'Navigation items', category: 'Appearance', href: '/app/settings/navigation', keywords: 'bottom tabs top bar hidden reorder Android', section: 'appearance', subcategory: 'navigation' },
  { title: 'Save watch history on this device', category: 'Home and library', href: '/app/settings/library', keywords: 'local progress privacy', key: 'save-watch-history-on-this-device', section: 'library', subcategory: 'history' },
  { title: 'Incognito mode', category: 'Home and library', href: '/app/settings/library', keywords: 'private browsing session ghost pause tracking sync anilist mal secret', key: 'incognito-mode', section: 'library', subcategory: 'history' },
  { title: 'Store', category: 'Sources and store', href: '/app/settings/store', keywords: 'source store addons extensions themes marketplace discover install packages custom stores', section: 'sources', subcategory: 'store' },
  { title: 'Import & export history', category: 'Devices and backup', href: '/app/settings/library#history', keywords: 'backup restore json', section: 'devices', subcategory: 'transfer' },
  { title: 'Clear watch history', category: 'Home and library', href: '/app/settings/library#history', keywords: 'delete forget watched', section: 'library', subcategory: 'history' },
  { title: 'Backup & restore', category: 'Devices and backup', href: '/app/settings/devices#backup', keywords: 'export import save file settings transfer move device secrets accounts', section: 'devices', subcategory: 'backup' },
  { title: 'Hotkeys', category: 'Playback', section: 'playback', subcategory: 'controls', href: '/app/settings/playback', key: 'hotkeys', keywords: 'keyboard shortcuts keys bindings remap', desktopOnly: true, hideOn: ['gamemode'] },

  { title: 'Device sync', category: 'Devices and backup', href: '/app/settings/devices', keywords: 'pair transfer another device local network', section: 'devices', subcategory: 'devices' },
  { title: 'Device name', category: 'Devices and backup', href: '/app/settings/devices', keywords: 'sync identity', key: 'device-name', section: 'devices', subcategory: 'devices' },
  { title: 'Watch progress sync', category: 'Devices and backup', href: '/app/settings/devices', keywords: 'history positions', key: 'watch-progress-sync', section: 'devices', subcategory: 'devices' },
  { title: 'Settings and sources sync', category: 'Devices and backup', href: '/app/settings/devices', keywords: 'extensions addons source setup transfer', key: 'settings-and-sources-sync', section: 'devices', subcategory: 'devices' },

  { title: 'Automatically add watched shows', category: 'Accounts and profiles', href: '/app/settings/accounts?section=behaviour', keywords: 'watchlist local watching episodes tracker auto', key: 'automatically-add-watched-shows', section: 'accounts', subcategory: 'trackers' },
  { title: 'Episodes before Watchlist', category: 'Accounts and profiles', href: '/app/settings/accounts?section=behaviour', keywords: 'watchlist threshold one three watched auto local', key: 'episodes-before-watchlist', section: 'accounts', subcategory: 'trackers' },
  { title: 'AniList account', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'oauth login tracker connect', key: 'anilist-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'MyAnimeList account', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'mal oauth login tracker connect', key: 'myanimelist-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'Kitsu account', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'username password login tracker connect', key: 'kitsu-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'Simkl account', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'device code browser login tracker connect', key: 'simkl-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'Trakt list provider', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'watchlist recommendations history personal lists connect stremio', key: 'trakt-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'Stremio add-on sync', category: 'Accounts and profiles', href: '/app/settings/accounts?section=connections', keywords: 'stremio account login addons collection sync', key: 'stremio-addon-account', section: 'accounts', subcategory: 'trackers' },
  { title: 'AniList public profile', category: 'Accounts and profiles', href: '/app/settings/accounts?section=libraries', keywords: 'username library read only no login', key: 'anilist-public-profile', section: 'accounts', subcategory: 'trackers' },
  { title: 'MyAnimeList public profile', category: 'Accounts and profiles', href: '/app/settings/accounts?section=libraries', keywords: 'mal username library read only no login', key: 'myanimelist-public-profile', section: 'accounts', subcategory: 'trackers' },
  { title: 'Letterboxd profile', category: 'Accounts and profiles', href: '/app/settings/accounts?section=libraries', keywords: 'letterboxd diary rss films export import watchlist', key: 'letterboxd-account', section: 'accounts', subcategory: 'trackers' },

  { title: 'Use DNS over HTTPS', category: 'Network and P2P', href: '/app/settings/network', keywords: 'doh privacy resolver', key: 'use-dns-over-https', section: 'network', subcategory: 'advanced', advanced: true },
  { title: 'DNS-over-HTTPS URL', category: 'Network and P2P', href: '/app/settings/network', keywords: 'endpoint cloudflare resolver', section: 'network', subcategory: 'advanced', advanced: true },
  { title: 'Torrent download limit', category: 'Network and P2P', href: '/app/settings/network', keywords: 'direct p2p throttle bandwidth mbps uncapped', section: 'network', subcategory: 'p2p' },
  { title: 'Torrent upload limit', category: 'Network and P2P', href: '/app/settings/network', keywords: 'direct p2p seed seeding upstream bandwidth auto capacity', section: 'network', subcategory: 'p2p' },
  { title: 'Direct P2P SOCKS5 proxy', category: 'Network and P2P', href: '/app/settings/network', keywords: 'torrent vpn bind proxy socks privacy kill switch', section: 'network', subcategory: 'advanced', advanced: true },
  { title: 'VPN adapter binding', category: 'Network and P2P', href: '/app/settings/network', keywords: 'torrent bind network interface adapter kill switch vpn nordvpn nordlynx mullvad proton wireguard surfshark expressvpn qbittorrent direct p2p', desktopOnly: true, section: 'network', subcategory: 'advanced', advanced: true },
  { title: 'Continue seeding after playback', category: 'Network and P2P', href: '/app/settings/network', keywords: 'android torrent charging unmetered wifi ratio', key: 'continue-seeding-after-playback', androidOnly: true, section: 'network', subcategory: 'advanced', advanced: true },

  { title: 'Check for updates', category: 'About', href: '/app/settings/about', keywords: 'auto check upgrade release launch new version', key: 'updates', section: 'about', subcategory: 'version' },
  { title: 'Release channel', category: 'About', href: '/app/settings/about', keywords: 'update channel stable beta pre-release', key: 'release-channel', desktopOnly: true, section: 'about', subcategory: 'advanced', advanced: true },
  { title: 'Developer tools', category: 'About', href: '/app/settings/about', keywords: 'inspect element console network logs debug errors', key: 'developer-tools', desktopOnly: true, section: 'about', subcategory: 'advanced', advanced: true },
  { title: 'Diagnostics report', category: 'About', href: '/app/settings/about', keywords: 'errors logs copy save bug report debug support', key: 'developer-tools', section: 'about', subcategory: 'advanced', advanced: true },
  { title: 'Reset izumi to defaults', category: 'About', href: '/app/settings/about', keywords: 'factory reset clear delete all local data start fresh wipe', key: 'reset-defaults', section: 'about', subcategory: 'reset' },
  { title: 'Changelog', category: 'About', href: '/app/settings/changelog', keywords: 'new changes release notes version', section: 'about', subcategory: 'changelog' },
  { title: 'App version and licences', category: 'About', href: '/app/settings/about', keywords: 'about legal open source', section: 'about', subcategory: 'version' },
]

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()

/** false when the hit's row is not shown in `env` (the platform flags and every `hideOn` tag). */
export function settingVisible(item: SettingSearchItem, env: SettingsSearchEnv): boolean {
  if (env.android ? item.desktopOnly : item.androidOnly) return false
  return !(item.hideOn ?? []).some((tag) => env[tag] === true)
}

/** The URL a hit opens: its href plus `setting=<key>` and, when set, `settingFallback=<fallbackKey>`.
 *  A hit without a key opens its href unchanged. */
export function settingHref(item: SettingSearchItem): string {
  if (!item.key) return item.href
  const params = new URLSearchParams({ [SETTING_PARAM]: item.key })
  if (item.fallbackKey) params.set(SETTING_FALLBACK_PARAM, item.fallbackKey)
  return `${item.href}${item.href.includes('?') ? '&' : '?'}${params.toString()}`
}

export function searchSettings(query: string, env: boolean | SettingsSearchEnv = false): SettingSearchItem[] {
  const context: SettingsSearchEnv = typeof env === 'boolean' ? { android: env } : env
  const q = normalize(query)
  if (!q) return []
  const words = q.split(/\s+/)
  return SETTINGS_SEARCH_INDEX
    .filter((item) => settingVisible(item, context))
    .map((item) => {
      const title = normalize(item.title)
      const category = normalize(item.category)
      const haystack = `${title} ${category} ${normalize(item.description ?? '')} ${normalize(item.keywords ?? '')}`
      if (!words.every((word) => haystack.includes(word))) return null
      let score = title === q ? 100 : title.startsWith(q) ? 70 : title.includes(q) ? 50 : category === q ? 30 : 10
      score -= Math.max(0, title.length - q.length) / 100
      return { item, score }
    })
    .filter((match): match is { item: SettingSearchItem; score: number } => match !== null)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .map(({ item }) => item)
}
