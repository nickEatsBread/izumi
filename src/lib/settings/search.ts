/** A hit is hidden where its row is not shown: on the phone layout (`phone`, `$isMobile`), on
 *  Android TV (`tv`) or on a build without the in-app player (`lite`, `!$inAppPlayerAvailable`). */
export type SettingHideOn = 'phone' | 'tv' | 'lite'

export type SettingSearchItem = {
  title: string
  category: string
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
}

/** What this device shows. A bare boolean passed to searchSettings means `{ android }`. */
export interface SettingsSearchEnv { android: boolean; phone?: boolean; tv?: boolean; lite?: boolean }

/** URL parameters a hit adds to its href; the settings layout hands them to revealSetting. */
export const SETTING_PARAM = 'setting'
export const SETTING_FALLBACK_PARAM = 'settingFallback'

export const settingKey = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export const SETTINGS_SEARCH_INDEX: SettingSearchItem[] = [
  { title: 'Profiles and parental PINs', category: 'Profiles', href: '/app/settings/profiles', keywords: 'household kids children age rating adult lock switch user' },
  { title: 'Audio processing', category: 'Player', href: '/app/settings/player', keywords: 'night mode dialogue boost volume loudnorm compressor limiter', hideOn: ['lite'] },
  { title: 'Video quality', category: 'Player', href: '/app/settings/player', keywords: 'mpv scale deband high performance standard anime custom ewa', hideOn: ['lite'] },
  { title: 'Audio language', category: 'Player', href: '/app/settings/player', keywords: 'Japanese English dub' },
  { title: 'Subtitle language', category: 'Player', href: '/app/settings/player', keywords: 'captions default language off' },
  { title: 'P2P playback status', category: 'Player', href: '/app/settings/player', keywords: 'torrent download upload speed peers buffering initial always hidden direct', hideOn: ['lite'] },
  { title: 'Auto-play next episode', category: 'Player', href: '/app/settings/player', key: 'auto-play-next-episode', hideOn: ['lite'] },
  { title: 'Show Up Next countdown', category: 'Player', href: '/app/settings/player', keywords: 'up next overlay card next episode end credits', key: 'show-up-next-countdown', hideOn: ['lite'] },
  { title: 'Miniplayer when you leave the app', category: 'Player', href: '/app/settings/player', keywords: 'picture in picture pip floating video home recents', key: 'miniplayer-when-you-leave-the-app', androidOnly: true, hideOn: ['tv', 'lite'] },
  { title: 'Discord Rich Presence', category: 'Player', href: '/app/settings/player', keywords: 'discord rpc activity status sharing privacy', key: 'discord-rich-presence', desktopOnly: true },
  { title: 'Keep screen awake while playing', category: 'Player', href: '/app/settings/player', keywords: 'sleep dim battery', key: 'keep-screen-awake-while-playing', hideOn: ['lite'] },
  { title: 'Binge next episode (preload)', category: 'Player', href: '/app/settings/player', keywords: 'buffer instant next auto advance', key: 'binge-next-episode-preload', hideOn: ['lite'] },
  { title: 'Auto-skip openings & endings', category: 'Player', href: '/app/settings/player', keywords: 'op ed intro outro recap chapters skip times', key: 'auto-skip-openings-endings', hideOn: ['lite'] },
  { title: 'Auto-skip next-episode previews', category: 'Player', href: '/app/settings/player', keywords: 'preview next episode trailer chapters', key: 'auto-skip-next-episode-previews', hideOn: ['lite'] },
  { title: 'Skip filler episodes', category: 'Player', href: '/app/settings/player', key: 'skip-filler-episodes', hideOn: ['lite'] },
  { title: 'Scrub preview thumbnails', category: 'Player', href: '/app/settings/player', keywords: 'seek frame preview', key: 'scrub-preview-thumbnails', hideOn: ['lite'] },
  { title: 'Animate player progress controls', category: 'Player', href: '/app/settings/player', keywords: 'animation motion fade smooth controls seek bar progress Steam Deck Game mode VacuumTube', key: 'animate-player-progress-controls', desktopOnly: true },
  { title: 'Subtitle line navigation', category: 'Player', href: '/app/settings/player', keywords: 'captions previous replay next cue language learning', key: 'subtitle-line-navigation', desktopOnly: true },
  { title: 'GIF recorder', category: 'Player', href: '/app/settings/player', keywords: 'gif capture record width quality anime screenshot', key: 'gif-recorder', desktopOnly: true },
  { title: 'Include subtitles in GIFs', category: 'Player', href: '/app/settings/player', keywords: 'gif capture record captions burn in', key: 'include-subtitles-in-gifs', fallbackKey: 'gif-recorder', hideOn: ['lite'] },
  { title: 'Player cache size', category: 'Player', href: '/app/settings/player', keywords: 'buffer ram memory', desktopOnly: true },
  { title: 'Seek duration', category: 'Player', href: '/app/settings/player', keywords: 'skip seconds arrows double tap', hideOn: ['lite'] },
  { title: 'Enable external player', category: 'Player', href: '/app/settings/player', keywords: 'mpv vlc', key: 'enable-external-player', desktopOnly: true },
  { title: 'Home-theatre audio', category: 'Player', href: '/app/settings/player', keywords: 'atmos dts passthrough receiver hdmi earc optical spdif dolby digital truehd surround', hideOn: ['lite'] },
  { title: 'Dolby Vision source handling', category: 'Player', href: '/app/settings/player', keywords: 'hdr hdr10 sdr tone map display output target', hideOn: ['lite'] },
  { title: 'Rating style', category: 'Interface', href: '/app/settings/interface', keywords: 'score vote rate my rating stars bar numbers 1-10 dropdown menu descriptor appearance', key: 'rating-style' },
  { title: 'Show rating on the series page', category: 'Interface', href: '/app/settings/interface', keywords: 'score vote your rating hide hidden always once rated series page', key: 'show-rating-on-the-series-page' },
  { title: 'Ask for a rating when a series ends', category: 'Player', href: '/app/settings/player', keywords: 'score vote rate finale finished prompt end of series', key: 'ask-for-a-rating-when-a-series-ends' },
  { title: 'Title language', category: 'Interface', href: '/app/settings/interface', keywords: 'romaji English anime names', key: 'title-language' },
  { title: 'Episode queue', category: 'Interface', href: '/app/settings/interface', keywords: 'watch next ordered list queue episode optional', key: 'episode-queue' },
  { title: 'Scene bookmarks', category: 'Interface', href: '/app/settings/interface', keywords: 'saved moments quote notes timestamp resume keep scene optional', key: 'scene-bookmarks' },
  { title: 'Title at top of player (Game mode)', category: 'Player', href: '/app/settings/player', keywords: 'Steam Deck now playing', key: 'title-at-top-of-player-game-mode', desktopOnly: true },

  { title: 'Use custom subtitle style', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'appearance font family size colour color border outline shadow position nunito', key: 'use-custom-subtitle-style' },
  { title: 'Subtitle dialogue style overrides', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'ASS signs songs karaoke typesetting preserve font readable dialogue only all elements', key: 'subtitle-dialogue-style-overrides' },
  { title: 'OpenSubtitles', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions', key: 'opensubtitles' },
  { title: 'SubDL', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions api key', key: 'subdl' },
  { title: 'OpenSubtitles account', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'login username password quota' },
  { title: 'Stay signed in', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'remember login' },
  { title: 'SubDL API key', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'token provider' },
  { title: 'Jimaku', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions api key japanese', key: 'jimaku' },
  { title: 'Jimaku API key', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'token provider japanese' },

  { title: 'Default catalog platform', category: 'Catalog', href: '/app/settings/catalog', keywords: 'startup home provider anilist kitsu tmdb stremio jvm aniyomi automatic', key: 'default-catalog-platform' },
  { title: 'Continue Watching', category: 'Catalog', href: '/app/settings/catalog', keywords: 'history progress current platform provider all combined separate scope', key: 'continue-watching' },
  { title: 'Catalog platforms', category: 'Catalog', href: '/app/settings/catalog', keywords: 'enable provider logo cycle switch anilist kitsu tmdb stremio jvm aniyomi automatic adaptive last selected default startup', key: 'catalog-platform-auto' },
  { title: 'Aniyomi sources', category: 'Catalog', href: '/app/settings/catalog', keywords: 'aniyomi extension provider popular latest browse filter' },
  { title: 'TMDB read access token', category: 'Catalog', href: '/app/settings/catalog', keywords: 'tmdb api key credential token movies television', key: 'tmdb-token', fallbackKey: 'catalog-platform-tmdb' },
  { title: 'OMDb API key', category: 'Catalog', href: '/app/settings/catalog', keywords: 'omdb rotten tomatoes metacritic imdb critic review ratings credential', key: 'omdb-key', fallbackKey: 'catalog-platform-tmdb' },
  { title: 'Nuvio account and community', category: 'Catalog', href: '/app/nuvio', keywords: 'login sign in signup connect device code collections packs covers artwork profiles browse search cloud library history progress resume sources preferences import export transfer' },
  { title: 'Collections and covers', category: 'Catalog', href: '/app/settings/catalog/collections', keywords: 'nuvio import json folders home artwork edit' },

  { title: 'Auto-play the best source', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'automatic stream cached countdown timer instant', key: 'auto-play-the-best-source' },
  { title: 'Preferred quality', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: '4k 1080p 720p resolution' },
  { title: 'Adaptive source planner', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'learn local reliability preview shadow agent automatic ranking', key: 'adaptive-source-planner' },
  { title: 'Stremio addon sources', category: 'Sources', href: '/app/settings/sources?tab=manage', keywords: 'manifest url torrent debrid' },
  { title: 'Mark best releases', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'seadex releases.moe curated encode quality badge recommended', key: 'mark-best-releases' },
  { title: 'Source priority', category: 'Sources', href: '/app/settings/sources/priority', keywords: 'order trust prefer strict addon extension provider first reorder' },
  { title: 'Default discussion source', category: 'Sources', href: '/app/settings/sources?tab=ordering', keywords: 'comments reddit anilist mal youtube disqus forum', key: 'default-discussion-source' },

  { title: 'Debrid provider', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'Real-Debrid AllDebrid Premiumize TorBox' },
  { title: 'Debrid token', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'api key credential password' },
  { title: 'Torrent playback', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'magnet direct p2p peer debrid' },
  { title: 'Source repositories', category: 'Sources', href: '/app/settings/sources?tab=manage', keywords: 'extension manifest github url plugins community' },

  { title: 'Offline mode', category: 'Downloads', href: '/app/settings/downloads', keywords: 'no network local', key: 'offline-mode' },
  { title: 'Download folder', category: 'Downloads', href: '/app/settings/downloads', keywords: 'directory path storage location' },
  { title: 'Simultaneous downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'concurrent concurrency number' },
  { title: 'Only download cached sources', category: 'Downloads', href: '/app/settings/downloads', keywords: 'instant debrid', key: 'only-download-cached-sources' },
  { title: 'Download quality', category: 'Downloads', href: '/app/settings/downloads', keywords: 'automatic offline release matching' },
  { title: 'Download audio', category: 'Downloads', href: '/app/settings/downloads', keywords: 'sub dub release matching' },
  { title: 'Download codec', category: 'Downloads', href: '/app/settings/downloads', keywords: 'h264 h265 hevc av1 release matching' },
  { title: 'Automatic downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'new episode subscription airing schedule' },
  { title: 'Episode airing notifications', category: 'Interface', href: '/app/settings/interface', keywords: 'notify alert schedule new episode', key: 'episode-airing-notifications' },
  { title: 'Theme and accessibility', category: 'Interface', href: '/app/settings/interface', keywords: 'light dark contrast motion focus wcag large targets' },
  { title: 'Storage used', category: 'Downloads', href: '/app/settings/downloads', keywords: 'disk space size' },
  { title: 'Saved scenes', category: 'App', href: '/app/settings/scenes', keywords: 'scene bookmarks quotes notes timestamps resume manage' },

  { title: 'Cache sizes', category: 'Storage', href: '/app/settings/storage', keywords: 'disk space used free cleanup hoarding' },
  { title: 'Scrub previews cache', category: 'Storage', href: '/app/settings/storage', keywords: 'thumbnails seek bar hover tiles clear' },
  { title: 'Direct P2P playback cache', category: 'Storage', href: '/app/settings/storage', keywords: 'torrent pieces streaming clear space' },
  { title: 'Downloaded subtitles cache', category: 'Storage', href: '/app/settings/storage', keywords: 'opensubtitles subdl jimaku srt clear' },
  { title: 'Clear all caches', category: 'Storage', href: '/app/settings/storage', keywords: 'free disk space delete cleanup' },

  { title: 'Haptics', category: 'Interface', href: '/app/settings/interface', keywords: 'vibration feedback Android', key: 'haptics' },
  { title: 'Theme Studio', category: 'Themes', href: '/app/settings/theme-studio', keywords: 'custom theme colours palette typography font radius backdrop contrast import export appearance' },
  { title: 'Themes', category: 'Themes', href: '/app/settings/themes', keywords: 'theme catalog gallery browse install link file folder community appearance layout izumi-themes' },
  { title: 'Episode list layout', category: 'Interface', href: '/app/settings/interface', keywords: 'cards compact' },
  { title: 'Series-wide episode numbers', category: 'Interface', href: '/app/settings/interface', keywords: 'absolute numbering season episode number continuous count', key: 'series-wide-episode-numbers' },
  { title: 'Browse layout', category: 'Interface', href: '/app/settings/interface', keywords: 'grid list covers' },
  { title: 'Schedule layout', category: 'Interface', href: '/app/settings/interface', keywords: 'agenda days' },
  { title: 'Pin schedule header', category: 'Interface', href: '/app/settings/interface', keywords: 'sticky', key: 'pin-schedule-header' },
  { title: 'Show "Next up" on the schedule', category: 'Interface', href: '/app/settings/interface', keywords: 'airing now countdown strip hide', key: 'show-next-up-on-the-schedule' },
  { title: 'Remove from Continue Watching', category: 'Interface', href: '/app/settings/interface', keywords: 'dismiss dropped paused on hold' },
  { title: 'UI scale', category: 'Interface', href: '/app/settings/interface', keywords: 'zoom size accessibility', key: 'ui-scale', hideOn: ['phone'] },
  { title: 'App language', category: 'Interface', href: '/app/settings/interface', keywords: 'language locale translation japanese english interface', key: 'app-language' },
  { title: 'Android TV layout', category: 'Interface', href: '/app/settings/interface', keywords: 'television remote dpad leanback ten foot focus wide couch', key: 'android-tv-layout', androidOnly: true },
  { title: 'Hide spoilers', category: 'Interface', href: '/app/settings/interface', keywords: 'blur episode thumbnails titles ratings', key: 'hide-spoilers' },
  { title: 'Show 18+ content', category: 'Interface', href: '/app/settings/interface', keywords: 'adult nsfw mature', key: 'show-18-content' },
  { title: 'Incognito for 18+ titles', category: 'Interface', href: '/app/settings/interface', keywords: 'adult nsfw private auto incognito ghost secret no sync', key: 'incognito-for-18-titles' },
  { title: 'Wheel-scroll carousels', category: 'Interface', href: '/app/settings/interface', keywords: 'mouse horizontal home rows', key: 'wheel-scroll-carousels' },

  { title: 'Navigation items', category: 'Navigation', href: '/app/settings/navigation', keywords: 'bottom tabs top bar hidden reorder Android' },
  { title: 'Save watch history on this device', category: 'History', href: '/app/settings/history', keywords: 'local progress privacy', key: 'save-watch-history-on-this-device' },
  { title: 'Incognito mode', category: 'History', href: '/app/settings/history', keywords: 'private browsing session ghost pause tracking sync anilist mal secret', key: 'incognito-mode' },
  { title: 'Store', category: 'Sources', href: '/app/settings/store', keywords: 'source store addons extensions themes marketplace discover install packages custom stores' },
  { title: 'Import & export history', category: 'History', href: '/app/settings/history', keywords: 'backup restore json' },
  { title: 'Clear watch history', category: 'History', href: '/app/settings/history', keywords: 'delete forget watched' },
  { title: 'Backup & restore', category: 'Backup', href: '/app/settings/backup', keywords: 'export import save file settings transfer move device secrets accounts' },
  { title: 'Hotkeys', category: 'Hotkeys', href: '/app/settings/hotkeys', keywords: 'keyboard shortcuts keys bindings remap', desktopOnly: true },

  { title: 'Device sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'pair transfer another device local network' },
  { title: 'Device name', category: 'Device sync', href: '/app/settings/sync', keywords: 'sync identity', key: 'device-name' },
  { title: 'Watch progress sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'history positions', key: 'watch-progress-sync' },
  { title: 'Settings and sources sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'extensions addons source setup transfer', key: 'settings-and-sources-sync' },

  { title: 'Automatically add watched shows', category: 'Accounts', href: '/app/settings/accounts?section=behaviour', keywords: 'watchlist local watching episodes tracker auto', key: 'automatically-add-watched-shows' },
  { title: 'Episodes before Watchlist', category: 'Accounts', href: '/app/settings/accounts?section=behaviour', keywords: 'watchlist threshold one three watched auto local', key: 'episodes-before-watchlist' },
  { title: 'AniList account', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'oauth login tracker connect', key: 'anilist-account' },
  { title: 'MyAnimeList account', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'mal oauth login tracker connect', key: 'myanimelist-account' },
  { title: 'Kitsu account', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'username password login tracker connect', key: 'kitsu-account' },
  { title: 'Simkl account', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'device code browser login tracker connect', key: 'simkl-account' },
  { title: 'Trakt list provider', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'watchlist recommendations history personal lists connect stremio', key: 'trakt-account' },
  { title: 'Stremio add-on sync', category: 'Accounts', href: '/app/settings/accounts?section=connections', keywords: 'stremio account login addons collection sync', key: 'stremio-addon-account' },
  { title: 'AniList public profile', category: 'Accounts', href: '/app/settings/accounts?section=libraries', keywords: 'username library read only no login', key: 'anilist-public-profile' },
  { title: 'MyAnimeList public profile', category: 'Accounts', href: '/app/settings/accounts?section=libraries', keywords: 'mal username library read only no login', key: 'myanimelist-public-profile' },
  { title: 'Letterboxd profile', category: 'Accounts', href: '/app/settings/accounts?section=libraries', keywords: 'letterboxd diary rss films export import watchlist', key: 'letterboxd-account' },

  { title: 'Use DNS over HTTPS', category: 'Network', href: '/app/settings/network', keywords: 'doh privacy resolver', key: 'use-dns-over-https' },
  { title: 'DNS-over-HTTPS URL', category: 'Network', href: '/app/settings/network', keywords: 'endpoint cloudflare resolver' },
  { title: 'Torrent download limit', category: 'Network', href: '/app/settings/network', keywords: 'direct p2p throttle bandwidth mbps uncapped' },
  { title: 'Torrent upload limit', category: 'Network', href: '/app/settings/network', keywords: 'direct p2p seed seeding upstream bandwidth auto capacity' },
  { title: 'Direct P2P SOCKS5 proxy', category: 'Network', href: '/app/settings/network', keywords: 'torrent vpn bind proxy socks privacy kill switch' },
  { title: 'VPN adapter binding', category: 'Network', href: '/app/settings/network', keywords: 'torrent bind network interface adapter kill switch vpn nordvpn nordlynx mullvad proton wireguard surfshark expressvpn qbittorrent direct p2p', desktopOnly: true },
  { title: 'Continue seeding after playback', category: 'Network', href: '/app/settings/network', keywords: 'android torrent charging unmetered wifi ratio', key: 'continue-seeding-after-playback', androidOnly: true },

  { title: 'Check for updates', category: 'About', href: '/app/settings/about', keywords: 'auto check upgrade release launch new version', key: 'updates' },
  { title: 'Release channel', category: 'About', href: '/app/settings/about', keywords: 'update channel stable beta pre-release', key: 'release-channel', desktopOnly: true },
  { title: 'Developer tools', category: 'About', href: '/app/settings/about', keywords: 'inspect element console network logs debug errors', key: 'developer-tools', desktopOnly: true },
  { title: 'Diagnostics report', category: 'About', href: '/app/settings/about', keywords: 'errors logs copy save bug report debug support', key: 'developer-tools' },
  { title: 'Reset izumi to defaults', category: 'About', href: '/app/settings/about', keywords: 'factory reset clear delete all local data start fresh wipe', key: 'reset-defaults' },
  { title: 'Changelog', category: 'Changelog', href: '/app/settings/changelog', keywords: 'new changes release notes version' },
  { title: 'App version and licences', category: 'About', href: '/app/settings/about', keywords: 'about legal open source' },
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
