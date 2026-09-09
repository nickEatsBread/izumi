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

// Hosted gateway routes: an add-on that resolves torrents on its own server hands back a playback
// URL on that server instead of the debrid file. Such routes are commonly minted for the network
// address that fetched the stream list, so a client that did not perform the listing itself can be
// refused. The public torrent hash the route names is enough to prepare the same release through
// the user's own provider from wherever playback actually happens.
const HOSTED_ROUTE_WORDS = /^(?:playback|play|resolve|stream|streams|link|links|download|dl|proxy|magnet|torrent|torrents|hash|infohash|info_hash)$/i

export function hostedRouteInfoHash(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const parts = url.pathname.split('/').filter(Boolean).map((part) => {
      try { return decodeURIComponent(part) } catch { return part }
    })
    // A bare hash segment that follows a routing word. Signed CDN paths can carry hex tokens too,
    // so a hash that no routing word introduces is left alone.
    for (let index = 1; index < parts.length; index++) {
      if (!INFO_HASH.test(parts[index])) continue
      if (parts.slice(0, index).some((part) => HOSTED_ROUTE_WORDS.test(part))) return parts[index].toLowerCase()
    }
    for (const [name, value] of url.searchParams) {
      if (/hash/i.test(name) && INFO_HASH.test(value)) return value.toLowerCase()
    }
    return undefined
  } catch {
    return undefined
  }
}
