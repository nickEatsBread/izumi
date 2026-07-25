import type { Stream } from './parse'

/** Stamp cache-check results onto streams as `__cache` hints, which `describe()` then reads.
 *
 *  Operates on Stream[] rather than StreamInfo[] deliberately: StreamPicker.svelte re-derives its
 *  rows by calling rankInfos(pick.streams) itself, so a patch applied to parsed rows would be
 *  discarded on the next re-derive.
 *
 *  - A hash absent from `map` is left alone. Absence means unknown, not "not cached".
 *  - Returns NEW objects; never mutates the input (the same Stream may be referenced by the
 *    Continue-Watching origin cache).
 *  - Preserves order. */
export function annotateCache(
  streams: Stream[],
  map: Map<string, 'cached' | 'uncached'>,
  source: 'native' | 'library',
): Stream[] {
  if (!map.size) return streams
  return streams.map((s) => {
    const h = s.infoHash?.toLowerCase()
    const hit = h ? map.get(h) : undefined
    return hit ? { ...s, __cache: hit, __cacheSource: source } : s
  })
}
