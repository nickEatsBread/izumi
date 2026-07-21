export type SettingSearchItem = {
  title: string
  category: string
  href: string
  description?: string
  keywords?: string
  /** Shared Toggle rows expose a matching DOM anchor, allowing search to scroll to the control. */
  anchored?: boolean
  desktopOnly?: boolean
}

export const settingKey = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export const SETTINGS_SEARCH_INDEX: SettingSearchItem[] = [
  { title: 'Audio language', category: 'Player', href: '/app/settings/player', keywords: 'Japanese English dub' },
  { title: 'Subtitle language', category: 'Player', href: '/app/settings/player', keywords: 'captions default language off' },
  { title: 'Auto-play next episode', category: 'Player', href: '/app/settings/player', anchored: true, desktopOnly: true },
  { title: 'Keep screen awake while playing', category: 'Player', href: '/app/settings/player', keywords: 'sleep dim battery', anchored: true, desktopOnly: true },
  { title: 'Binge next episode (preload)', category: 'Player', href: '/app/settings/player', keywords: 'buffer instant next', anchored: true, desktopOnly: true },
  { title: 'Auto-skip openings & endings', category: 'Player', href: '/app/settings/player', keywords: 'op ed recap aniskip', anchored: true, desktopOnly: true },
  { title: 'Skip filler episodes', category: 'Player', href: '/app/settings/player', anchored: true, desktopOnly: true },
  { title: 'Scrub preview thumbnails', category: 'Player', href: '/app/settings/player', keywords: 'seek frame preview', anchored: true, desktopOnly: true },
  { title: 'Player cache size', category: 'Player', href: '/app/settings/player', keywords: 'buffer ram memory', desktopOnly: true },
  { title: 'Seek duration', category: 'Player', href: '/app/settings/player', keywords: 'skip seconds arrows', desktopOnly: true },
  { title: 'Enable external player', category: 'Player', href: '/app/settings/player', keywords: 'mpv vlc', anchored: true, desktopOnly: true },
  { title: 'Title language', category: 'Player', href: '/app/settings/player', keywords: 'romaji English anime names' },
  { title: 'Title at top of player (Game mode)', category: 'Player', href: '/app/settings/player', keywords: 'Steam Deck now playing', anchored: true, desktopOnly: true },
  { title: 'Clear video cache', category: 'Player', href: '/app/settings/player', keywords: 'storage thumbnails', desktopOnly: true },

  { title: 'OpenSubtitles', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions', anchored: true },
  { title: 'SubDL', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'provider captions api key', anchored: true },
  { title: 'OpenSubtitles account', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'login username password quota' },
  { title: 'Stay signed in', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'remember login' },
  { title: 'SubDL API key', category: 'Subtitles', href: '/app/settings/subtitles', keywords: 'token provider' },

  { title: 'Auto-play the best source', category: 'Sources', href: '/app/settings/sources', keywords: 'automatic stream cached', anchored: true },
  { title: 'Animate the countdown', category: 'Sources', href: '/app/settings/sources', keywords: 'auto play timer', anchored: true },
  { title: 'Preferred quality', category: 'Sources', href: '/app/settings/sources', keywords: '4k 1080p 720p resolution' },
  { title: 'Stremio addon sources', category: 'Sources', href: '/app/settings/sources', keywords: 'manifest url torrent debrid' },
  { title: 'In-player discussion panel', category: 'Sources', href: '/app/settings/sources', keywords: 'comments reddit anilist mal youtube disqus', anchored: true },
  { title: 'Default discussion source', category: 'Sources', href: '/app/settings/sources', keywords: 'comments reddit forum' },

  { title: 'Debrid provider', category: 'Extensions', href: '/app/settings/extensions', keywords: 'Real-Debrid AllDebrid Premiumize TorBox' },
  { title: 'Debrid token', category: 'Extensions', href: '/app/settings/extensions', keywords: 'api key credential password' },
  { title: 'Torrent playback', category: 'Extensions', href: '/app/settings/extensions', keywords: 'magnet direct p2p peer debrid' },
  { title: 'Extension repositories', category: 'Extensions', href: '/app/settings/extensions', keywords: 'manifest github url plugins' },

  { title: 'Offline mode', category: 'Downloads', href: '/app/settings/downloads', keywords: 'no network local', anchored: true },
  { title: 'Download folder', category: 'Downloads', href: '/app/settings/downloads', keywords: 'directory path storage location' },
  { title: 'Simultaneous downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'concurrent concurrency number' },
  { title: 'Only download cached sources', category: 'Downloads', href: '/app/settings/downloads', keywords: 'instant debrid', anchored: true },
  { title: 'Download quality', category: 'Downloads', href: '/app/settings/downloads', keywords: 'automatic offline release matching' },
  { title: 'Download audio', category: 'Downloads', href: '/app/settings/downloads', keywords: 'sub dub release matching' },
  { title: 'Download codec', category: 'Downloads', href: '/app/settings/downloads', keywords: 'h264 h265 hevc av1 release matching' },
  { title: 'Automatic downloads', category: 'Downloads', href: '/app/settings/downloads', keywords: 'new episode subscription airing schedule' },
  { title: 'Storage used', category: 'Downloads', href: '/app/settings/downloads', keywords: 'disk space size' },

  { title: 'Haptics', category: 'Interface', href: '/app/settings/interface', keywords: 'vibration feedback Android', anchored: true },
  { title: 'Episode list layout', category: 'Interface', href: '/app/settings/interface', keywords: 'cards compact' },
  { title: 'Browse layout', category: 'Interface', href: '/app/settings/interface', keywords: 'grid list covers' },
  { title: 'Schedule layout', category: 'Interface', href: '/app/settings/interface', keywords: 'agenda days' },
  { title: 'Pin schedule header', category: 'Interface', href: '/app/settings/interface', keywords: 'sticky', anchored: true },
  { title: 'Remove from Continue Watching', category: 'Interface', href: '/app/settings/interface', keywords: 'dismiss dropped paused on hold' },
  { title: 'UI scale', category: 'Interface', href: '/app/settings/interface', keywords: 'zoom size accessibility' },
  { title: 'Hide spoilers', category: 'Interface', href: '/app/settings/interface', keywords: 'blur episode thumbnails titles ratings', anchored: true },
  { title: 'Show 18+ content', category: 'Interface', href: '/app/settings/interface', keywords: 'adult nsfw mature', anchored: true },
  { title: 'Wheel-scroll carousels', category: 'Interface', href: '/app/settings/interface', keywords: 'mouse horizontal home rows', anchored: true },

  { title: 'Navigation items', category: 'Navigation', href: '/app/settings/navigation', keywords: 'bottom tabs top bar hidden reorder Android' },
  { title: 'Save watch history on this device', category: 'History', href: '/app/settings/history', keywords: 'local progress privacy', anchored: true },
  { title: 'Import & export history', category: 'History', href: '/app/settings/history', keywords: 'backup restore json' },
  { title: 'Clear watch history', category: 'History', href: '/app/settings/history', keywords: 'delete forget watched' },

  { title: 'Device sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'pair transfer another device local network' },
  { title: 'Device name', category: 'Device sync', href: '/app/settings/sync', keywords: 'sync identity' },
  { title: 'Watch progress sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'history positions' },
  { title: 'Settings and extensions sync', category: 'Device sync', href: '/app/settings/sync', keywords: 'sources setup transfer' },

  { title: 'AniList account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'username login tracker connect' },
  { title: 'MyAnimeList account', category: 'Accounts', href: '/app/settings/accounts', keywords: 'mal username login tracker connect' },

  { title: 'Use DNS over HTTPS', category: 'Network', href: '/app/settings/network', keywords: 'doh privacy resolver', anchored: true },
  { title: 'DNS-over-HTTPS URL', category: 'Network', href: '/app/settings/network', keywords: 'endpoint cloudflare resolver' },
  { title: 'Transfer speed limit', category: 'Network', href: '/app/settings/network', keywords: 'throttle bandwidth mbps torrent downloads' },

  { title: 'Auto-check for updates', category: 'About', href: '/app/settings/about', keywords: 'upgrade release launch', anchored: true },
  { title: 'Update channel', category: 'About', href: '/app/settings/about', keywords: 'stable beta release' },
  { title: 'Changelog', category: 'Changelog', href: '/app/settings/changelog', keywords: 'new changes release notes version' },
  { title: 'App version and licences', category: 'About', href: '/app/settings/about', keywords: 'about legal open source' },
]

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim()

export function searchSettings(query: string, android = false): SettingSearchItem[] {
  const q = normalize(query)
  if (!q) return []
  const words = q.split(/\s+/)
  return SETTINGS_SEARCH_INDEX
    .filter((item) => !android || !item.desktopOnly)
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
