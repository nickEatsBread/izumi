export type DeepLinkTarget = { path: string; notice?: string }

/** Parse only navigation intent here. A magnet link never starts playback without the picker. */
export function parseDeepLink(raw: string): DeepLinkTarget | null {
  try {
    const url = new URL(raw)
    if (url.protocol === 'magnet:') {
      const name = url.searchParams.get('dn')?.trim()
      return name ? { path: `/app/search?q=${encodeURIComponent(name)}`, notice: 'Magnet opened in search' } : { path: '/app/search' }
    }
    if (url.protocol !== 'izumi:') return null
    const parts = [url.hostname, ...url.pathname.split('/').filter(Boolean)]
    const kind = parts.shift()
    if ((kind === 'anime' || kind === 'watch') && /^\d+$/.test(parts[0] ?? '')) {
      const id = parts[0]
      const episode = kind === 'watch' && /^\d+(?:\.\d+)?$/.test(parts[1] ?? '') ? `?episode=${parts[1]}` : ''
      return { path: `/app/anime/${id}${episode}` }
    }
    if (kind === 'search') {
      const query = url.searchParams.get('q') ?? parts.join(' ')
      return { path: `/app/search${query ? `?q=${encodeURIComponent(query)}` : ''}` }
    }
  } catch { /* malformed external input */ }
  return null
}
