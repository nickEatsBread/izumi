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
  /** The row renders only in the phone layout (`phone`, `$isMobile`). */
  phoneOnly?: true
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
  { title: 'AniList account', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'oauth login tracker connect', key: 'anilist-account' },
  { title: 'MyAnimeList account', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'mal oauth login tracker connect', key: 'myanimelist-account' },
  { title: 'Kitsu account', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'username password login tracker connect', key: 'kitsu-account' },
  { title: 'Simkl account', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'device code browser login tracker connect', key: 'simkl-account' },
  { title: 'Trakt list provider', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'watchlist recommendations history personal lists connect stremio', key: 'trakt-account' },
  { title: 'Stremio add-on sync', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'stremio account login addons collection sync', key: 'stremio-addon-account' },
  { title: 'Letterboxd profile', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'letterboxd diary rss films export import watchlist', key: 'letterboxd-account' },
  { title: 'AniList public profile', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'username library read only no login', key: 'anilist-public-profile' },
  { title: 'MyAnimeList public profile', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'mal username library read only no login', key: 'myanimelist-public-profile' },
  { title: 'Automatically add watched shows', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'watchlist local watching episodes tracker auto', key: 'automatically-add-watched-shows' },
  { title: 'Episodes before Watchlist', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'trackers', keywords: 'watchlist threshold one three watched auto local', key: 'episodes-before-watchlist' },
  { title: 'Keys and credentials', category: 'Accounts and profiles', href: '/app/settings/accounts#keys', section: 'accounts', subcategory: 'keys', keywords: 'api key token credential password' },
  { title: 'Profiles and parental PINs', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'profiles', keywords: 'household kids children age rating adult lock switch user', key: 'household-profiles' },
  { title: 'Show 18+ content', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'content', keywords: 'adult nsfw mature', key: 'show-18-content' },
  { title: 'Incognito for 18+ titles', category: 'Accounts and profiles', href: '/app/settings/accounts', section: 'accounts', subcategory: 'content', keywords: 'adult nsfw private auto incognito ghost secret no sync', key: 'incognito-for-18-titles' },
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
  { title: 'Rating style', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'ratings', keywords: 'score vote rate my rating stars bar numbers 1-10 dropdown menu descriptor appearance', key: 'rating-style' },
  { title: 'Show rating on the series page', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'ratings', keywords: 'score vote your rating hide hidden always once rated series page', key: 'show-rating-on-the-series-page' },
  { title: 'Ask for a rating when a series ends', category: 'Playback', section: 'playback', subcategory: 'up-next', href: '/app/settings/playback', keywords: 'score vote rate finale finished prompt end of series', key: 'ask-for-a-rating-when-a-series-ends' },
  { title: 'Title language', category: 'Languages', section: 'languages', subcategory: 'app', href: '/app/settings/languages', key: 'title-language', keywords: 'romaji English anime names' },
  { title: 'Episode queue', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'features', keywords: 'watch next ordered list queue episode optional', key: 'episode-queue' },
  { title: 'Scene bookmarks', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'scenes', keywords: 'saved moments quote notes timestamp resume keep scene optional', key: 'scene-bookmarks' },
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

  { title: 'Default catalog platform', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'startup home provider anilist kitsu tmdb stremio jvm aniyomi automatic', key: 'default-catalog-platform' },
  { title: 'Continue Watching', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'history progress current platform provider all combined separate scope', key: 'continue-watching' },
  { title: 'Catalog platforms', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'enable provider logo cycle switch anilist kitsu tmdb stremio jvm aniyomi automatic adaptive last selected default startup', key: 'catalog-platform-auto' },
  { title: 'Per-extension catalogs', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'advanced', advanced: true, keywords: 'aniyomi extension provider popular latest browse filter sources', key: 'per-extension-catalogs', fallbackKey: 'catalog-platform-jvm' },
  { title: 'TMDB read access token', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'tmdb api key credential token movies television', key: 'tmdb-token', fallbackKey: 'catalog-platform-tmdb' },
  { title: 'OMDb API key', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'omdb rotten tomatoes metacritic imdb critic review ratings credential', key: 'omdb-key', fallbackKey: 'catalog-platform-tmdb' },
  { title: 'Nuvio account and community', category: 'Home and library', href: '/app/nuvio', keywords: 'login sign in signup connect device code collections packs covers artwork profiles browse search cloud library history progress resume sources preferences import export transfer', section: 'library', subcategory: 'home' },
  { title: 'Collections and covers', category: 'Home and library', href: '/app/settings/library/collections', section: 'library', subcategory: 'home', keywords: 'nuvio import json folders home artwork edit' },
  { title: 'Customize Home', category: 'Home and library', href: '/app/settings/library/home', section: 'library', subcategory: 'home', keywords: 'home rows sections order hide reorder layout' },

  { title: 'Auto-play the best source', category: 'Playback', section: 'playback', subcategory: 'quality', href: '/app/settings/playback', keywords: 'automatic stream cached countdown timer instant', key: 'auto-play-the-best-source' },
  { title: 'Preferred quality', category: 'Playback', section: 'playback', subcategory: 'quality', href: '/app/settings/playback', key: 'preferred-quality', fallbackKey: 'auto-play-the-best-source', keywords: '4k 1080p 720p resolution' },
  { title: 'Adaptive source planner', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'learn local reliability preview shadow agent automatic ranking', key: 'adaptive-source-planner' },
  { title: 'Add-on sources', category: 'Sources and store', href: '/app/settings/sources/manage', section: 'sources', subcategory: 'my-sources', keywords: 'stremio manifest url torrent debrid add install' },
  { title: 'Mark best releases', category: 'Playback', section: 'playback', subcategory: 'advanced', advanced: true, href: '/app/settings/playback', keywords: 'seadex releases.moe curated encode quality badge recommended', key: 'mark-best-releases' },
  { title: 'Source priority', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'priority', keywords: 'order trust prefer strict addon extension provider first reorder', key: 'source-priority' },
  { title: 'Default discussion source', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'discussion', keywords: 'comments reddit anilist mal youtube disqus forum', key: 'default-discussion-source' },

  { title: 'Debrid provider', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'debrid', keywords: 'Real-Debrid AllDebrid Premiumize TorBox service', key: 'debrid-service' },
  { title: 'Debrid token', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'debrid', keywords: 'api key credential password login', key: 'debrid-key' },
  { title: 'Torrent playback', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'debrid', keywords: 'magnet direct p2p peer debrid', key: 'torrent-playback' },
  { title: 'Source repositories', category: 'Sources and store', href: '/app/settings/sources/manage', section: 'sources', subcategory: 'my-sources', keywords: 'extension manifest github url plugins community' },
  { title: 'Source priority mode', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'advanced', advanced: true, keywords: 'prefer strict only listed sources order', key: 'source-priority-mode' },
  { title: 'Check for package updates', category: 'Sources and store', href: '/app/settings/sources', section: 'sources', subcategory: 'advanced', advanced: true, keywords: 'extension package catalog update refresh', key: 'package-updates' },

  { title: 'Offline mode', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'offline', keywords: 'no network local', key: 'offline-mode' },
  { title: 'Download folder', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'folder', keywords: 'directory path storage location', key: 'download-folder' },
  { title: 'Simultaneous downloads', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'advanced', advanced: true, keywords: 'concurrent concurrency number', key: 'simultaneous-downloads' },
  { title: 'Only download cached sources', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'advanced', advanced: true, keywords: 'instant debrid', key: 'only-download-cached-sources' },
  { title: 'Download quality', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'folder', keywords: 'automatic offline release matching', key: 'download-quality' },
  { title: 'Download audio', category: 'Languages', section: 'languages', subcategory: 'downloads', href: '/app/settings/languages', key: 'download-audio', keywords: 'sub dub release matching' },
  { title: 'Download codec', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'advanced', advanced: true, keywords: 'h264 h265 hevc av1 release matching', key: 'download-codec' },
  { title: 'Automatic downloads', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'folder', keywords: 'new episode subscription airing schedule', key: 'automatic-downloads' },
  { title: 'Episode airing notifications', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'notifications', keywords: 'notify alert schedule new episode', key: 'episode-airing-notifications' },
  { title: 'Theme', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'theme', keywords: 'light dark palette colour color preset midnight sakura ocean system appearance', key: 'theme-preset' },
  { title: 'Themes', category: 'Appearance', href: '/app/settings/themes', section: 'appearance', subcategory: 'theme', keywords: 'theme catalog gallery browse install link file folder community appearance layout izumi-themes' },
  { title: 'Theme Studio', category: 'Appearance', href: '/app/settings/theme-studio', section: 'appearance', subcategory: 'theme', keywords: 'custom theme colours palette typography font radius backdrop contrast import export appearance' },
  { title: 'Motion', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'accessibility', keywords: 'animation reduce reduced motion transitions accessibility', key: 'motion' },
  { title: 'High contrast', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'accessibility', keywords: 'contrast wcag focus ring borders accessibility', key: 'high-contrast' },
  { title: 'Larger interaction targets', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'accessibility', keywords: 'large touch targets 44 accessibility', key: 'larger-interaction-targets' },
  { title: 'UI scale', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'accessibility', keywords: 'zoom size accessibility', key: 'ui-scale', hideOn: ['phone'] },
  { title: 'Haptics', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'accessibility', keywords: 'vibration feedback Android', key: 'haptics', androidOnly: true },
  { title: 'Navigation items', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'navigation', keywords: 'bottom tabs top bar hidden reorder Android phone', key: 'navigation-items', phoneOnly: true },
  { title: 'Android TV layout', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'tv', keywords: 'television remote dpad leanback ten foot focus wide couch', key: 'android-tv-layout', androidOnly: true },
  { title: 'Wheel-scroll carousels', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'advanced', advanced: true, keywords: 'mouse horizontal home rows trackpad', key: 'wheel-scroll-carousels' },
  { title: 'Mouse-drag carousels', category: 'Appearance', href: '/app/settings/appearance', section: 'appearance', subcategory: 'advanced', advanced: true, keywords: 'mouse drag swipe banner home rows', key: 'mouse-drag-carousels' },
  { title: 'Storage used', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'disk space size', key: 'storage-used' },
  { title: 'Saved scenes', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'scenes', keywords: 'scene bookmarks quotes notes timestamps resume manage', key: 'saved-scenes' },

  { title: 'Cache sizes', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'disk space used free cleanup hoarding', key: 'cache-total' },
  { title: 'Scrub previews cache', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'thumbnails seek bar hover tiles clear', key: 'cache-thumbs' },
  { title: 'Direct P2P playback cache', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'torrent pieces streaming clear space', key: 'cache-direct-torrents' },
  { title: 'Torrent metadata cache', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'torrent info repeat play faster start clear', key: 'cache-torrent-metadata' },
  { title: 'Downloaded subtitles cache', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'opensubtitles subdl jimaku srt clear', key: 'cache-subs' },
  { title: 'Clear all caches', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'storage', keywords: 'free disk space delete cleanup', key: 'cache-total' },
  { title: 'New-episode delay', category: 'Downloads and storage', href: '/app/settings/downloads', section: 'downloads', subcategory: 'advanced', advanced: true, keywords: 'automatic download wait minutes air time release', key: 'new-episode-delay' },

  { title: 'Episode list layout', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'layouts', keywords: 'cards compact numbers grid', key: 'episode-list-layout' },
  { title: 'Series-wide episode numbers', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'advanced', advanced: true, keywords: 'absolute numbering season episode number continuous count', key: 'series-wide-episode-numbers' },
  { title: 'Browse layout', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'layouts', keywords: 'grid list covers', key: 'browse-layout' },
  { title: 'Schedule layout', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'layouts', keywords: 'agenda days desktop', key: 'schedule-layout', hideOn: ['phone', 'tv', 'gamemode'] },
  { title: 'Pin schedule header', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'advanced', advanced: true, keywords: 'sticky', key: 'pin-schedule-header' },
  { title: 'Show "Next up" on the schedule', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'layouts', keywords: 'airing now countdown strip hide', key: 'show-next-up-on-the-schedule' },
  { title: 'Remove from Continue Watching', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'home', keywords: 'dismiss dropped paused on hold', key: 'remove-from-continue-watching' },
  { title: 'App language', category: 'Languages', section: 'languages', subcategory: 'app', href: '/app/settings/languages', key: 'app-language', keywords: 'language locale translation japanese english interface' },
  { title: 'Hide spoilers', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'ratings', keywords: 'blur episode thumbnails titles ratings', key: 'hide-spoilers' },

  { title: 'Save watch history on this device', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'history', keywords: 'local progress privacy', key: 'save-watch-history-on-this-device' },
  { title: 'Incognito mode', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'history', keywords: 'private browsing session ghost pause tracking sync anilist mal secret', key: 'incognito-mode' },
  { title: 'Store', category: 'Sources and store', href: '/app/settings/store', section: 'sources', subcategory: 'store', keywords: 'source store addons extensions themes marketplace discover install packages custom stores' },
  { title: 'Import & export history', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'history', keywords: 'backup restore json xml', key: 'import-export-history' },
  { title: 'Clear watch history', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'history', keywords: 'delete forget watched list', key: 'watched-history' },
  { title: 'Default Schedule tab', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'layouts', keywords: 'release calendar watchlist opens first', key: 'default-schedule-tab' },
  { title: 'Catalog switcher', category: 'Home and library', href: '/app/settings/library', section: 'library', subcategory: 'advanced', advanced: true, keywords: 'picker logo placement below integrated automatic', key: 'catalog-switcher-placement' },
  { title: 'Hotkeys', category: 'Playback', section: 'playback', subcategory: 'controls', href: '/app/settings/playback', key: 'hotkeys', keywords: 'keyboard shortcuts keys bindings remap', desktopOnly: true, hideOn: ['gamemode'] },

  { title: 'Device sync', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'devices', keywords: 'pair transfer another device local network', key: 'device-sync' },
  { title: 'Device name', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'devices', keywords: 'sync identity', key: 'device-name', fallbackKey: 'device-sync' },
  { title: 'Watch progress sync', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'devices', keywords: 'history positions', key: 'watch-progress-sync', fallbackKey: 'device-sync' },
  { title: 'Add a device', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'devices', keywords: 'pair new device nearby set up qr first run', key: 'add-a-device', fallbackKey: 'device-sync' },
  { title: 'TV connections', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'tv', keywords: 'samsung tizen companion pair code television restore', key: 'tv-pairing' },
  { title: 'TV playback through your Worker', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'tv', keywords: 'cloudflare tv sources resolver closed', key: 'tv-playback-worker', fallbackKey: 'tv-pairing' },
  { title: 'Backup and restore', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'backup', keywords: 'export import save file settings transfer move device secrets accounts', key: 'create-backup' },
  { title: 'Settings and sources sync', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'transfer', keywords: 'extensions addons source setup transfer share', key: 'settings-and-sources-sync' },
  { title: 'Connection method', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'advanced', advanced: true, keywords: 'peer to peer cloudflare worker self hosted provider', key: 'sync-connection' },
  { title: 'Worker updates', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'advanced', advanced: true, keywords: 'cloudflare worker version update deploy token', key: 'worker-updates', fallbackKey: 'sync-connection' },
  { title: 'Pairing ticket', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'advanced', advanced: true, keywords: 'ticket join different network copy', key: 'pairing-ticket', fallbackKey: 'sync-connection' },
  { title: 'Peer-to-peer relay', category: 'Devices and backup', href: '/app/settings/devices', section: 'devices', subcategory: 'advanced', advanced: true, keywords: 'iroh relay custom public watch together', key: 'peer-to-peer-relay' },


  { title: 'Torrent download limit', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'p2p', keywords: 'direct p2p throttle bandwidth mbps uncapped', key: 'torrent-download-limit' },
  { title: 'Torrent upload limit', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'p2p', keywords: 'direct p2p seed seeding upstream bandwidth auto capacity', key: 'torrent-upload-limit' },
  { title: 'Use DNS over HTTPS', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'advanced', advanced: true, keywords: 'doh privacy resolver', key: 'use-dns-over-https' },
  { title: 'DNS-over-HTTPS URL', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'advanced', advanced: true, keywords: 'endpoint cloudflare resolver', key: 'use-dns-over-https' },
  { title: 'VPN adapter binding', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'advanced', advanced: true, keywords: 'torrent bind network interface adapter kill switch vpn nordvpn nordlynx mullvad proton wireguard surfshark expressvpn qbittorrent direct p2p', key: 'vpn-adapter-binding', desktopOnly: true },
  { title: 'Direct P2P SOCKS5 proxy', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'advanced', advanced: true, keywords: 'torrent vpn bind proxy socks privacy kill switch', key: 'require-socks5-proxy' },
  { title: 'Continue seeding after playback', category: 'Network and P2P', href: '/app/settings/network', section: 'network', subcategory: 'advanced', advanced: true, keywords: 'android torrent charging unmetered wifi ratio', key: 'continue-seeding-after-playback', androidOnly: true },

  { title: 'App version and licences', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'version', keywords: 'about legal open source version build', key: 'app-version' },
  { title: 'Check for updates', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'version', keywords: 'auto check upgrade release launch new version', key: 'updates' },
  { title: 'Changelog', category: 'About', href: '/app/settings/about/changelog', section: 'about', subcategory: 'changelog', keywords: 'new changes release notes version' },
  { title: 'License information', category: 'About', href: '/app/settings/about/license-information', section: 'about', subcategory: 'licenses', keywords: 'licence license open source agpl tmdb attribution legal' },
  { title: 'Setup assistant', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'reset', keywords: 'onboarding wizard first run setup again language playback', key: 'setup-assistant' },
  { title: 'Reset izumi to defaults', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'reset', keywords: 'factory reset clear delete all local data start fresh wipe', key: 'reset-defaults' },
  { title: 'Release channel', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'advanced', advanced: true, keywords: 'update channel stable beta pre-release', key: 'release-channel', desktopOnly: true },
  { title: 'Developer logging', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'advanced', advanced: true, keywords: 'verbose debug logs devtools jvm native', key: 'developer-logging', desktopOnly: true },
  { title: 'Diagnostics report', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'advanced', advanced: true, keywords: 'errors logs copy save bug report debug support', key: 'diagnostics-report' },
  { title: 'Developer tools', category: 'About', href: '/app/settings/about', section: 'about', subcategory: 'advanced', advanced: true, keywords: 'inspect element console network logs debug errors', key: 'developer-tools', desktopOnly: true },
]

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()

/** false when the hit's row is not shown in `env` (the platform flags and every `hideOn` tag). */
export function settingVisible(item: SettingSearchItem, env: SettingsSearchEnv): boolean {
  if (env.android ? item.desktopOnly : item.androidOnly) return false
  if (item.phoneOnly && !env.phone) return false
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
