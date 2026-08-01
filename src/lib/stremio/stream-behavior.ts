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

/** Map standard addon playback hints into Izumi's internal fields at the ingestion boundary. */
export function normalizeStreamBehavior(stream: Stream): Stream {
  const proxyHeaders = safeProxyHeaders(stream.behaviorHints?.proxyHeaders?.request)
  const trackers = (stream.sources ?? [])
    .filter((source): source is string => typeof source === 'string' && source.startsWith(TRACKER_PREFIX))
    .map((source) => source.slice(TRACKER_PREFIX.length).trim())
    .filter((tracker) => /^https?:\/\/|^udp:\/\//i.test(tracker))

  let magnet = stream.__magnet
  if (!magnet && stream.infoHash) magnet = `magnet:?xt=urn:btih:${stream.infoHash}`
  if (magnet && trackers.length) {
    const existing = new Set<string>()
    try {
      const parsed = new URL(magnet)
      for (const tracker of parsed.searchParams.getAll('tr')) existing.add(tracker)
      for (const tracker of trackers) {
        if (existing.has(tracker)) continue
        parsed.searchParams.append('tr', tracker)
        existing.add(tracker)
      }
      magnet = parsed.toString()
    } catch { /* malformed magnets remain untouched */ }
  }

  return {
    ...stream,
    __magnet: magnet ?? stream.__magnet,
    __headers: { ...(proxyHeaders ?? {}), ...(stream.__headers ?? {}) },
  }
}
