export type DeepLinkTarget = { path: string; notice?: string }

/** What a batch of incoming links resolves to: somewhere to navigate, something to tell the user,
 *  or both. `null` means there was nothing to act on at all. */
export type DeepLinkOutcome = { path?: string; notice?: string }

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

/**
 * Decide what to do with one delivery of deep links. The OS can hand over several URLs at once but
 * there is only one window to steer, so the first understood link wins — the rest are ignored on
 * purpose. When nothing is understood we still return a notice: an `izumi://` link with a typo'd
 * kind used to navigate nowhere and say nothing, which reads exactly like the app being broken.
 */
export function resolveDeepLinks(urls: readonly string[] | null | undefined): DeepLinkOutcome | null {
  const candidates = (urls ?? []).map((raw) => raw.trim()).filter(Boolean)
  if (!candidates.length) return null
  for (const raw of candidates) {
    const target = parseDeepLink(raw)
    if (target) return target
  }
  return { notice: candidates.length > 1 ? "Those links aren't ones Izumi can open" : "That link isn't one Izumi can open" }
}
