// Torrentio debrid streams are credential-bearing resolver URLs rather than ordinary HTTP media.
// Recover only the public infohash so Izumi can resolve it locally; never retain or share the token.

const DEBRID_PROVIDER = /^(?:realdebrid|alldebrid|premiumize|torbox|debridlink|offcloud)$/i
const INFO_HASH = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i

export function torrentioResolverInfoHash(rawUrl: string | undefined, addonHint?: string): string | undefined {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const torrentio = /torrentio/i.test(url.hostname) || /torrentio/i.test(addonHint ?? '')
    if (!torrentio) return undefined

    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
    const resolve = parts.findIndex((part) => part.toLowerCase() === 'resolve')
    if (resolve < 0 || !DEBRID_PROVIDER.test(parts[resolve + 1] ?? '')) return undefined
    return parts.slice(resolve + 2).find((part) => INFO_HASH.test(part))?.toLowerCase()
  } catch {
    return undefined
  }
}
