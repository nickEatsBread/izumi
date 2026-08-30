import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'

export type RememberedTrackKind = 'audio' | 'subtitle'

export interface RememberableTrack {
  id: number
  type: string
  lang?: string
  title?: string
  codec?: string
  external?: boolean
}

export interface RememberedTrack {
  lang?: string
  title?: string
  codec?: string
  external?: boolean
  off?: boolean
  updatedAt: number
}

export interface SeriesTrackPreferences {
  audio?: RememberedTrack
  subtitle?: RememberedTrack
}

export const seriesTrackPreferences = persisted<Record<string, SeriesTrackPreferences>>(
  'series-track-preferences-v1',
  {},
)

const clean = (value?: string) => value?.trim().toLocaleLowerCase() || undefined

export function rememberSeriesTrack(
  mediaId: number | null | undefined,
  kind: RememberedTrackKind,
  track: RememberableTrack | null,
): void {
  if (mediaId == null) return
  const key = String(mediaId)
  seriesTrackPreferences.update((all) => ({
    ...all,
    [key]: {
      ...(all[key] ?? {}),
      [kind]: track
        ? {
            lang: clean(track.lang),
            title: clean(track.title),
            codec: clean(track.codec),
            external: track.external,
            updatedAt: Date.now(),
          }
        : { off: true, updatedAt: Date.now() },
    },
  }))
}

export function rememberedSeriesTrack(
  mediaId: number | null | undefined,
  kind: RememberedTrackKind,
): RememberedTrack | undefined {
  return mediaId == null ? undefined : get(seriesTrackPreferences)[String(mediaId)]?.[kind]
}

/** Stable semantic matching: exact title+language wins, then codec, then language. Numeric mpv ids
 * are intentionally never persisted because they change between releases and episodes. */
export function matchRememberedTrack<T extends RememberableTrack>(
  tracks: T[],
  preference: RememberedTrack | undefined,
): T | null | undefined {
  if (!preference) return undefined
  if (preference.off) return null
  const scored = tracks.map((track) => {
    let score = 0
    const lang = clean(track.lang)
    const title = clean(track.title)
    const codec = clean(track.codec)
    // Language is the strongest guardrail: a generic title such as "Stereo" must never make a
    // Japanese track outrank the remembered English track. Title and codec refine that match.
    if (preference.lang && lang === preference.lang) score += 16
    if (preference.title && title === preference.title) score += 8
    if (preference.codec && codec === preference.codec) score += 4
    if (preference.external != null && track.external === preference.external) score += 1
    return { track, score }
  }).filter((candidate) => candidate.score > 0)
  scored.sort((left, right) => right.score - left.score)
  return scored[0]?.track
}

export function pruneSeriesTrackPreferences(maxEntries = 500): void {
  seriesTrackPreferences.update((all) => {
    const entries = Object.entries(all)
    if (entries.length <= maxEntries) return all
    entries.sort(([, left], [, right]) => Math.max(left.audio?.updatedAt ?? 0, left.subtitle?.updatedAt ?? 0)
      - Math.max(right.audio?.updatedAt ?? 0, right.subtitle?.updatedAt ?? 0))
    return Object.fromEntries(entries.slice(entries.length - maxEntries))
  })
}

export function mergeSeriesTrackPreferences(incoming: unknown): number {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return 0
  let imported = 0
  seriesTrackPreferences.update((current) => {
    const next = { ...current }
    for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !raw || typeof raw !== 'object') continue
      const candidate = raw as SeriesTrackPreferences
      const merged = { ...(next[key] ?? {}) }
      for (const kind of ['audio', 'subtitle'] as const) {
        const value = candidate[kind]
        if (!value || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) continue
        if (value.updatedAt > (merged[kind]?.updatedAt ?? 0)) { merged[kind] = value; imported++ }
      }
      next[key] = merged
    }
    return imported ? next : current
  })
  if (imported) pruneSeriesTrackPreferences()
  return imported
}
