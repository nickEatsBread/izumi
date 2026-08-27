export type SettingSearchItem = {
  title: string
  category: string
  href: string
  description?: string
  keywords?: string
  /** Shared Toggle rows expose a matching DOM anchor, allowing search to scroll to the control. */
  anchored?: boolean
  desktopOnly?: boolean
  androidOnly?: boolean
}

export const settingKey = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export const SETTINGS_SEARCH_INDEX: SettingSearchItem[] = [
  { title: 'Audio processing', category: 'Player', href: '/app/settings/player', keywords: 'night mode dialogue boost volume loudnorm compressor limiter' },
  { title: 'Video quality', category: 'Player', href: '/app/settings/player', keywords: 'mpv scale deband high performance standard anime custom ewa' },
  { title: 'Audio language', category: 'Player', href: '/app/settings/player', keywords: 'Japanese English dub' },
  { title: 'Subtitle language', category: 'Player', href: '/app/settings/player', keywords: 'captions default language off' },
  { title: 'P2P playback status', category: 'Player', href: '/app/settings/player', keywords: 'torrent download upload speed peers buffering initial always hidden direct' },
  { title: 'Auto-play next episode', category: 'Player', href: '/app/settings/player', anchored: true, desktopOnly: true },
  { title: 'Discord Rich Presence', category: 'Player', href: '/app/settings/player', keywords: 'discord rpc activity status sharing privacy', anchored: true, desktopOnly: true },
  { title: 'Keep screen awake while playing', category: 'Player', href: '/app/settings/player', keywords: 'sleep dim battery', anchored: true, desktopOnly: true },
  { title: 'Binge next episode (preload)', category: 'Player', href: '/app/settings/player', keywords: 'buffer instant next', anchored: true, desktopOnly: true },
  { title: 'Auto-skip openings & endings', category: 'Player', href: '/app/settings/player', keywords: 'op ed recap aniskip', anchored: true, desktopOnly: true },
  { title: 'Skip filler episodes', category: 'Player', href: '/app/settings/player', anchored: true, desktopOnly: true },
  { title: 'Scrub preview thumbnails', category: 'Player', href: '/app/settings/player', keywords: 'seek frame preview', anchored: true, desktopOnly: true },
  { title: 'Animate player progress controls', category: 'Player', href: '/app/settings/player', keywords: 'animation motion fade smooth controls seek bar progress Steam Deck Game mode VacuumTube', anchored: true, desktopOnly: true },
  { title: 'Subtitle line navigation', category: 'Player', href: '/app/settings/player', keywords: 'captions previous replay next cue language learning', anchored: true, desktopOnly: true },
  { title: 'GIF recorder', category: 'Player', href: '/app/settings/player', keywords: 'gif capture record width quality anime screenshot', anchored: true, desktopOnly: true },
  { title: 'Include subtitles in GIFs', category: 'Player', href: '/app/settings/player', keywords: 'gif capture record captions burn in', anchored: true },
  { title: 'Player cache size', category: 'Player', href: '/app/settings/player', keywords: 'buffer ram memory', desktopOnly: true },
  { title: 'Seek duration', category: 'Player', href: '/app/settings/player', keywords: 'skip seconds arrows', desktopOnly: true },
  { title: 'Enable external player', category: 'Player', href: '/app/settings/player', keywords: 'mpv vlc', anchored: true, desktopOnly: true },
  { title: 'Title language', category: 'Interface', href: '/app/settings/interface', keywords: 'romaji English anime names', anchored: true },
  { title: 'Title at top of player (Game mode)', category: 'Player', href: '/app/settings/player', keywords: 'Steam Deck now playing', anchored: true, desktopOnly: true },

  { title: 'Use custom subtitle style', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'appearance font family size colour color border outline shadow position nunito', anchored: true },
  { title: 'Subtitle dialogue style overrides', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'ASS signs songs karaoke typesetting preserve font readable dialogue only all elements', anchored: true },
  { title: 'OpenSubtitles', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions', anchored: true },
  { title: 'SubDL', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions api key', anchored: true },
  { title: 'OpenSubtitles account', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'login username password quota' },
  { title: 'Stay signed in', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'remember login' },
  { title: 'SubDL API key', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'token provider' },
  { title: 'Jimaku', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions api key japanese', anchored: true },
  { title: 'Jimaku API key', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'token provider japanese' },

  { title: 'Default catalog platform', category: 'Catalog', href: '/app/settings/catalog', keywords: 'startup home provider anilist kitsu tmdb stremio automatic', anchored: true },
  { title: 'Continue Watching', category: 'Catalog', href: '/app/settings/catalog', keywords: 'history progress current platform provider all combined separate scope', anchored: true },
  { title: 'Catalog platforms', category: 'Catalog', href: '/app/settings/catalog', keywords: 'enable provider logo cycle switch anilist kitsu tmdb stremio automatic adaptive last selected default startup' },

  { title: 'Auto-play the best source', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'automatic stream cached countdown timer instant', anchored: true },
  { title: 'Preferred quality', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: '4k 1080p 720p resolution' },
  { title: 'Adaptive source planner', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'learn local reliability preview shadow agent automatic ranking', anchored: true },
  { title: 'Stremio addon sources', category: 'Sources', href: '/app/settings/sources?tab=manage', keywords: 'manifest url torrent debrid' },
  { title: 'Mark best releases', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'seadex releases.moe curated encode quality badge recommended', anchored: true },
  { title: 'Source priority', category: 'Sources', href: '/app/settings/sources/priority', keywords: 'order trust prefer strict addon extension provider first reorder' },
  { title: 'Default discussion source', category: 'Sources', href: '/app/settings/sources?tab=ordering', keywords: 'comments reddit anilist mal youtube disqus forum', anchored: true },

  { title: 'Debrid provider', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'Real-Debrid AllDebrid Premiumize TorBox' },
  { title: 'Debrid token', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'api key credential password' },
  { title: 'Torrent playback', category: 'Sources', href: '/app/settings/sources?tab=playback', keywords: 'magnet direct p2p peer debrid' },
  { title: 'Source repositories', category: 'Sources', href: '/app/settings/sources?tab=manage', keywords: 'extension manifest github url plugins community' },

  { title: 'Offline mode', category: 'Downloads', href: '/app/settings/downloads', keywords: 'no network local', anchored: true },
  { title: 'Download folder', category: 'Downloads', href: '/app/settings/downloads', keywords: 'directory path storage location' },
  { title: 'Simultaneous downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'concurrent concurrency number' },
  { title: 'Only download cached sources', category: 'Downloads', href: '/app/settings/downloads', keywords: 'instant debrid', anchored: true },
  { title: 'Download quality', category: 'Downloads', href: '/app/settings/downloads', keywords: 'automatic offline release matching' },
  { title: 'Download audio', category: 'Downloads', href: '/app/settings/downloads', keywords: 'sub dub release matching' },
  { title: 'Download codec', category: 'Downloads', href: '/app/settings/downloads', keywords: 'h264 h265 hevc av1 release matching' },
  { title: 'Automatic downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'new episode subscription airing schedule' },
  { title: 'Episode airing notifications', category: 'Interface', href: '/app/settings/interface', keywords: 'notify alert schedule new episode', anchored: true },
  { title: 'Theme and accessibility', category: 'Interface', href: '/app/settings/interface', keywords: 'light dark contrast motion focus wcag large targets' },
  { title: 'Storage used', category: 'Downloads', href: '/app/settings/downloads', keywords: 'disk space size' },

  { title: 'Cache sizes', category: 'Storage', href: '/app/settings/storage', keywords: 'disk space used free cleanup hoarding' },
  { title: 'Scrub previews cache', category: 'Storage', href: '/app/settings/storage', keywords: 'thumbnails seek bar hover tiles clear' },
  { title: 'Direct P2P playback cache', category: 'Storage', href: '/app/settings/storage', keywords: 'torrent pieces streaming clear space' },
  { title: 'Downloaded subtitles cache', category: 'Storage', href: '/app/settings/storage', keywords: 'opensubtitles subdl jimaku srt clear' },
  { title: 'Clear all caches', category: 'Storage', href: '/app/settings/storage', keywords: 'free disk space delete cleanup' },

  { title: 'Haptics', category: 'Interface', href: '/app/settings/interface', keywords: 'vibration feedback Android', anchored: true },
  { title: 'Episode list layout', category: 'Interface', href: '/app/settings/interface', keywords: 'cards compact' },
  { title: 'Series-wide episode numbers', category: 'Interface', href: '/app/settings/interface', keywords: 'absolute numbering season episode number continuous count', anchored: true },
  { title: 'Browse layout', category: 'Interface', href: '/app/settings/interface', keywords: 'grid list covers' },
  { title: 'Schedule layout', category: 'Interface', href: '/app/settings/interface', keywords: 'agenda days' },
  { title: 'Pin schedule header', category: 'Interface', href: '/app/settings/interface', keywords: 'sticky', anchored: true },
  { title: 'Show "Next up" on the schedule', category: 'Interface', href: '/app/settings/interface', keywords: 'airing now countdown strip hide', anchored: true },
  { title: 'Remove from Continue Watching', category: 'Interface', href: '/app/settings/interface', keywords: 'dismiss dropped paused on hold' },
  { title: 'UI scale', category: 'Interface', href: '/app/settings/interface', keywords: 'zoom size accessibility' },
  { title: 'Hide spoilers', category: 'Interface', href: '/app/settings/interface', keywords: 'blur episode thumbnails titles ratings', anchored: true },
  { title: 'Show 18+ content', category: 'Interface', href: '/app/settings/interface', keywords: 'adult nsfw mature', anchored: true },
  { title: 'Incognito for 18+ titles', category: 'Interface', href: '/app/settings/interface', keywords: 'adult nsfw private auto incognito ghost secret no sync', anchored: true },
  { title: 'Wheel-scroll carousels', category: 'Interface', href: '/app/settings/interface', keywords: 'mouse horizontal home rows', anchored: true },

  { title: 'Navigation items', category: 'Navigation', href: '/app/settings/navigation', keywords: 'bottom tabs top bar hidden reorder Android' },
  { title: 'Save watch history on this device', category: 'History', href: '/app/settings/history', keywords: 'local progress privacy', anchored: true },
  { title: 'Incognito mode', category: 'History', href: '/app/settings/history', keywords: 'private browsing session ghost pause tracking sync anilist mal secret', anchored: true },
  { title: 'Source Store', category: 'Sources', href: '/app/settings/sources?tab=manage', keywords: 'addons extensions marketplace discover install enabled packages' },
  { title: 'Import & export history', category: 'History', href: '/app/settings/history', keywords: 'backup restore json' },
  { title: 'Clear watch history', category: 'History', href: '/app/settings/history', keywords: 'delete forget watched' },

  { title: 'Device sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'pair transfer another device local network' },
  { title: 'Device name', category: 'Device sync', href: '/app/settings/sync', keywords: 'sync identity', anchored: true },
  { title: 'Watch progress sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'history positions', anchored: true },
  { title: 'Settings and sources sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'extensions addons source setup transfer', anchored: true },

  { title: 'Move to Watching after 90 seconds', category: 'Accounts', href: '/app/settings/accounts', keywords: 'promote planning current tracker auto', anchored: true },
  { title: 'AniList account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'oauth login tracker connect', anchored: true },
  { title: 'MyAnimeList account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'mal oauth login tracker connect', anchored: true },
  { title: 'Kitsu account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'username password login tracker connect', anchored: true },
  { title: 'Simkl account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'device code browser login tracker connect', anchored: true },
  { title: 'AniList public profile', category: 'Accounts', href: '/app/settings/accounts', keywords: 'username library read only no login', anchored: true },
  { title: 'MyAnimeList public profile', category: 'Accounts', href: '/app/settings/accounts', keywords: 'mal username library read only no login', anchored: true },

  { title: 'Use DNS over HTTPS', category: 'Network', href: '/app/settings/network', keywords: 'doh privacy resolver', anchored: true },
  { title: 'DNS-over-HTTPS URL', category: 'Network', href: '/app/settings/network', keywords: 'endpoint cloudflare resolver' },
  { title: 'Torrent download limit', category: 'Network', href: '/app/settings/network', keywords: 'direct p2p throttle bandwidth mbps uncapped' },
  { title: 'Torrent upload limit', category: 'Network', href: '/app/settings/network', keywords: 'direct p2p seed seeding upstream bandwidth auto capacity' },
  { title: 'Direct P2P SOCKS5 proxy', category: 'Network', href: '/app/settings/network', keywords: 'torrent vpn bind proxy socks privacy kill switch' },
  { title: 'VPN adapter binding', category: 'Network', href: '/app/settings/network', keywords: 'torrent bind network interface adapter kill switch vpn nordvpn nordlynx mullvad proton wireguard surfshark expressvpn qbittorrent direct p2p', desktopOnly: true },
  { title: 'Continue seeding after playback', category: 'Network', href: '/app/settings/network', keywords: 'android torrent charging unmetered wifi ratio', anchored: true, androidOnly: true },

  { title: 'Auto-check for updates', category: 'About', href: '/app/settings/about', keywords: 'upgrade release launch', anchored: true },
  { title: 'Update channel', category: 'About', href: '/app/settings/about', keywords: 'stable beta release' },
  { title: 'Developer tools', category: 'About', href: '/app/settings/about', keywords: 'inspect element console network logs debug errors', anchored: true, desktopOnly: true },
  { title: 'Changelog', category: 'Changelog', href: '/app/settings/changelog', keywords: 'new changes release notes version' },
  { title: 'App version and licences', category: 'About', href: '/app/settings/about', keywords: 'about legal open source' },
]

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()

export function searchSettings(query: string, android = false): SettingSearchItem[] {
  const q = normalize(query)
  if (!q) return []
  const words = q.split(/\s+/)
  return SETTINGS_SEARCH_INDEX
    .filter((item) => android ? !item.desktopOnly : !item.androidOnly)
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
