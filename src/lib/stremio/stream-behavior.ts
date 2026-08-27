import type { Stream } from './parse'

const TRACKER_PREFIX = 'tracker:'

/** Reject line breaks so an addon cannot smuggle another native HTTP header through a value. */
export function safeProxyHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!name.trim() || /[\r\n:]/.test(name) || typeof raw !== 'string' || /[\r\n]/.test(raw)) continue
    if (raw.trim()) out[name.trim()] = raw.trim()
  }
  return Object.keys(out).length ? out : undefined
}

/** Append tracker entries to a magnet, skipping any it already carries.
 *  Assembled by string concatenation on purpose. A magnet is an opaque URI, not a hierarchical
 *  URL, so round-tripping one through the URL class re-serialises the whole query: `xt=urn:btih:x`
 *  comes back as `xt=urn%3Abtih%3Ax` (which every downstream infoHash extraction then fails to
 *  match) and `dn=Some Show` becomes `dn=Some+Show`. Everything already in the magnet is left
 *  byte-for-byte, and only the new `tr` values we add are encoded. */
export function appendMagnetTrackers(magnet: string, trackers: string[]): string {
  const query = magnet.indexOf('?')
  if (!trackers.length || !/^magnet:/i.test(magnet) || query < 0) return magnet

  // Compare decoded, since an existing `tr` arrives percent-encoded but our candidates do not.
  const existing = new Set<string>()
  for (const pair of magnet.slice(query + 1).split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 0 || pair.slice(0, eq).toLowerCase() !== 'tr') continue
    const value = pair.slice(eq + 1)
    try { existing.add(decodeURIComponent(value)) } catch { existing.add(value) }
  }

  let out = magnet
  for (const tracker of trackers) {
    if (existing.has(tracker)) continue
    existing.add(tracker)
    out += `${out.endsWith('?') || out.endsWith('&') ? '' : '&'}tr=${encodeURIComponent(tracker)}`
  }
  return out
}

/** Map standard addon playback hints into Izumi's internal fields at the ingestion boundary. */
export function normalizeStreamBehavior(stream: Stream): Stream {
  const proxyHeaders = safeProxyHeaders(stream.behaviorHints?.proxyHeaders?.request)
  const trackers = (stream.sources ?? [])
    .filter((source): source is string => typeof source === 'string' && source.startsWith(TRACKER_PREFIX))
    .map((source) => source.slice(TRACKER_PREFIX.length).trim())
    .filter((tracker) => /^https?:\/\/|^udp:\/\//i.test(tracker))

  let magnet = stream.__magnet
  if (!magnet && stream.infoHash) magnet = `magnet:?xt=urn:btih:${stream.infoHash}`
  if (magnet) magnet = appendMagnetTrackers(magnet, trackers)

  const standardSubtitles = (Array.isArray(stream.subtitles) ? stream.subtitles : [])
    .filter((subtitle) => subtitle && typeof subtitle.url === 'string' && !!subtitle.url.trim())
    .map((subtitle) => ({
      id: typeof subtitle.id === 'string' ? subtitle.id : undefined,
      url: subtitle.url.trim(),
      lang: typeof subtitle.lang === 'string' && subtitle.lang.trim() ? subtitle.lang.trim() : undefined,
    }))
  const countryWhitelist = (Array.isArray(stream.behaviorHints?.countryWhitelist)
    ? stream.behaviorHints.countryWhitelist
    : [])
    .filter((country): country is string => typeof country === 'string')
    .map((country) => country.trim().toLowerCase())
    .filter((country, index, countries) => /^[a-z]{3}$/.test(country) && countries.indexOf(country) === index)

  return {
    ...stream,
    __magnet: magnet ?? stream.__magnet,
    __headers: { ...(proxyHeaders ?? {}), ...(stream.__headers ?? {}) },
    __subtitles: [...(stream.__subtitles ?? []), ...standardSubtitles],
    __countryWhitelist: countryWhitelist.length ? countryWhitelist : undefined,
  }
}
