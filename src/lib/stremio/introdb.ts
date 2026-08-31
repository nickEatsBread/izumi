import { getExtensionIds, type ExtIds } from '$lib/anizip'
import type { Media } from '$lib/anilist/types'
import { externalIdsOf } from '$lib/catalog/identity'
import { phttp } from '$lib/net/http'
import { LABELS, mergeOverlapping, type Segment, type SkipType } from './aniskip'

const API = 'https://api.introdb.app/segments'

export interface IntroDbWindow {
  start_sec?: number | string | null
  end_sec?: number | string | null
  start_ms?: number | null
  end_ms?: number | null
}

export interface IntroDbResponse {
  intro?: IntroDbWindow | IntroDbWindow[] | null
  recap?: IntroDbWindow | IntroDbWindow[] | null
  outro?: IntroDbWindow | IntroDbWindow[] | null
}

function seconds(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value)
  const parts = value.trim().split(':').map(Number)
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const windows = (value: IntroDbWindow | IntroDbWindow[] | null | undefined): IntroDbWindow[] =>
  value == null ? [] : Array.isArray(value) ? value : [value]

/** Convert IntroDB's intro/recap/outro response to the player's common segment model. Both its
 * documented seconds and millisecond fields are accepted so an API migration cannot silently
 * remove the skip button. */
export function segmentsFromIntroDb(response: IntroDbResponse, duration = 0): Segment[] {
  const groups: Array<[IntroDbWindow | IntroDbWindow[] | null | undefined, SkipType]> = [
    [response.intro, 'op'],
    [response.recap, 'recap'],
    [response.outro, 'ed'],
  ]
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY
  const segments = groups.flatMap(([raw, type]) => windows(raw).flatMap((window) => {
    const rawStart = seconds(window.start_sec) ?? (window.start_ms == null ? undefined : window.start_ms / 1_000)
    const rawEnd = seconds(window.end_sec) ?? (window.end_ms == null ? undefined : window.end_ms / 1_000)
    if (rawStart == null || rawEnd == null) return []
    const start = Math.max(0, Math.min(upper, rawStart))
    const end = Math.max(0, Math.min(upper, rawEnd))
    return end > start ? [{ start, end, type, label: LABELS[type] }] : []
  }))
  return mergeOverlapping(segments)
}

export function introDbUrl(imdbId: string, season: number, episode: number): string {
  const url = new URL(API)
  url.searchParams.set('imdb_id', imdbId)
  url.searchParams.set('season', String(season))
  url.searchParams.set('episode', String(episode))
  return url.toString()
}

interface Coordinates { imdbId: string; season: number; episode: number }

async function coordinates(media: Media, episode: number): Promise<Coordinates | null> {
  if (media.type === 'MOVIE' || media.format === 'MOVIE' || media.catalog?.type === 'movie') return null
  const video = media.videos?.find((entry) => entry.number === episode) ?? media.videos?.[episode - 1]
  const ids = externalIdsOf(media)
  const mapped: ExtIds = ids.anilist && (!ids.imdb || video?.season == null || video?.episode == null)
    ? await getExtensionIds(ids.anilist, episode).catch(() => ({}))
    : {}
  const imdbId = ids.imdb ?? mapped.imdbId
  const season = video?.season ?? mapped.season ?? media.seasonNumber ?? 1
  const episodeNumber = video?.episode ?? mapped.episodeNumber ?? episode
  if (!imdbId || !/^tt\d{7,8}$/i.test(imdbId)) return null
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) return null
  return { imdbId, season, episode: episodeNumber }
}

const cache = new Map<string, { expiresAt: number; promise: Promise<Segment[]> }>()
const HIT_TTL_MS = 30 * 60_000
const MISS_TTL_MS = 60_000

/** Public read-only IntroDB lookup. Its API requires no credential; Izumi sends only an IMDb id
 * plus season/episode coordinates and keeps a short local cache to respect fair-use limits. */
export async function getIntroDbSegments(media: Media | null | undefined, episode: number | null | undefined, duration = 0): Promise<Segment[]> {
  if (!media || !episode) return []
  const target = await coordinates(media, episode)
  if (!target) return []
  const key = `${target.imdbId}:${target.season}:${target.episode}`
  const existing = cache.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.promise
  if (existing) cache.delete(key)

  const promise = (async () => {
    try {
      const response = await phttp(introDbUrl(target.imdbId, target.season, target.episode), {
        timeoutMs: 8_000,
        maxBytes: 128 * 1024,
      })
      if (!response.ok) return []
      return segmentsFromIntroDb(await response.json() as IntroDbResponse, duration)
    } catch { return [] }
  })()
  cache.set(key, { expiresAt: Date.now() + HIT_TTL_MS, promise })
  void promise.then((segments) => {
    const entry = cache.get(key)
    if (entry?.promise === promise && !segments.length) entry.expiresAt = Date.now() + MISS_TTL_MS
  })
  return promise
}

export function clearIntroDbCache(): void {
  cache.clear()
}
