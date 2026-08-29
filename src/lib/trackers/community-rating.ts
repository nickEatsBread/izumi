import type { Media, MediaRating } from '$lib/anilist/types'
import { externalIdsOf } from '$lib/catalog/identity'
import { kitsuFetch } from './kitsu-auth'
import { resolveKitsuId } from './kitsu'
import { malFetch } from './mal-auth'
import { simklFetch } from './simkl-auth'
import type { TrackerRatingProvider } from './connection-order'

const normalizedSource = (value: string) => value.toLowerCase().replaceAll(/[^a-z]/g, '')
const sourceMatches = (provider: TrackerRatingProvider, source: string) => {
  const normalized = normalizedSource(source)
  return provider === 'mal' ? normalized === 'myanimelist' || normalized === 'mal' : normalized === provider
}

function validRating(source: string, score: unknown, scale: 10 | 100, votes?: unknown): MediaRating | undefined {
  const number = Number(score)
  if (!Number.isFinite(number) || number <= 0 || number > scale) return undefined
  const count = Number(votes)
  return {
    source,
    score: number,
    scale,
    ...(Number.isFinite(count) && count >= 0 ? { votes: count } : {}),
  }
}

export function parseMalCommunityRating(value: unknown): MediaRating | undefined {
  const data = value as { mean?: unknown; num_scoring_users?: unknown }
  return validRating('MyAnimeList', data?.mean, 10, data?.num_scoring_users)
}

export function parseKitsuCommunityRating(value: unknown): MediaRating | undefined {
  const attributes = (value as {
    data?: { attributes?: { averageRating?: unknown; ratingFrequencies?: Record<string, unknown> } }
  })?.data?.attributes
  const frequencies = Object.values(attributes?.ratingFrequencies ?? {})
  const votes = frequencies.length
    ? frequencies.reduce<number>((total, count) => total + (Number(count) || 0), 0)
    : undefined
  return validRating('Kitsu', attributes?.averageRating, 100, votes)
}

export function parseSimklCommunityRating(value: unknown): MediaRating | undefined {
  const rating = (value as { simkl?: { rating?: unknown; votes?: unknown } })?.simkl
  return validRating('Simkl', rating?.rating, 10, rating?.votes)
}

/** Use an already-present score synchronously when its provenance matches the linked service. */
export function providerRatingOnMedia(media: Media, provider: TrackerRatingProvider): MediaRating | undefined {
  const exact = media.ratings?.find((rating) => sourceMatches(provider, rating.source))
  if (exact) return exact
  if (provider === 'anilist' && (!media.ratings || media.ratings.length === 0)
      && (!media.catalog || media.catalog.provider === 'anilist')
      && media.averageScore != null && media.averageScore > 0) {
    return { source: 'AniList', score: media.averageScore, scale: 100 }
  }
  return undefined
}

export function communityRatingKey(media: Media, provider: TrackerRatingProvider): string | undefined {
  const ids = externalIdsOf(media)
  if (provider === 'anilist') return ids.anilist ? `anilist:${ids.anilist}` : undefined
  if (provider === 'mal') return ids.mal ? `mal:${ids.mal}` : undefined
  if (provider === 'kitsu') {
    if (ids.kitsu) return `kitsu:kitsu:${ids.kitsu}`
    if (ids.anilist) return `kitsu:anilist:${ids.anilist}`
    return ids.mal ? `kitsu:mal:${ids.mal}` : undefined
  }
  if (ids.mal) return `simkl:mal:${ids.mal}`
  if (ids.anilist) return `simkl:anilist:${ids.anilist}`
  return ids.kitsu ? `simkl:kitsu:${ids.kitsu}` : undefined
}

type CachedRating = MediaRating | null
const ratingCache = new Map<string, CachedRating>()
const ratingInflight = new Map<string, Promise<CachedRating>>()

async function fetchProviderRating(media: Media, provider: TrackerRatingProvider): Promise<CachedRating> {
  const embedded = providerRatingOnMedia(media, provider)
  if (embedded) return embedded
  const ids = externalIdsOf(media)

  if (provider === 'anilist') return null
  if (provider === 'mal') {
    if (!ids.mal) return null
    const response = await malFetch(`https://api.myanimelist.net/v2/anime/${ids.mal}?fields=mean,num_scoring_users`)
    if (!response) return null
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`MyAnimeList rating request failed (${response.status})`)
    return parseMalCommunityRating(await response.json()) ?? null
  }

  if (provider === 'kitsu') {
    const id = await resolveKitsuId({
      kind: 'progress',
      mediaId: media.id,
      idAniList: ids.anilist,
      idMal: ids.mal,
      idKitsu: ids.kitsu,
    })
    if (!id) return null
    const response = await kitsuFetch(`https://kitsu.io/api/edge/anime/${id}?fields%5Banime%5D=averageRating%2CratingFrequencies`)
    if (!response) return null
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Kitsu rating request failed (${response.status})`)
    return parseKitsuCommunityRating(await response.json()) ?? null
  }

  const params = new URLSearchParams({ type: 'anime', fields: 'simkl' })
  if (ids.mal) params.set('mal', String(ids.mal))
  else if (ids.anilist) params.set('anilist', String(ids.anilist))
  else if (ids.kitsu) params.set('kitsu', String(ids.kitsu))
  else return null
  const response = await simklFetch(`/ratings?${params}`)
  if (!response) return null
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Simkl rating request failed (${response.status})`)
  return parseSimklCommunityRating(await response.json()) ?? null
}

/** Lazy, session-cached community rating for the service selected by connection order. */
export async function loadProviderCommunityRating(
  media: Media,
  provider: TrackerRatingProvider,
): Promise<MediaRating | undefined> {
  const embedded = providerRatingOnMedia(media, provider)
  if (embedded) return embedded
  const key = communityRatingKey(media, provider)
  if (!key) return undefined
  if (ratingCache.has(key)) return ratingCache.get(key) ?? undefined
  let request = ratingInflight.get(key)
  if (!request) {
    request = fetchProviderRating(media, provider)
      .then((rating) => { ratingCache.set(key, rating); return rating })
      .finally(() => ratingInflight.delete(key))
    ratingInflight.set(key, request)
  }
  try { return await request ?? undefined }
  catch { return undefined }
}

/** Test-only reset for the session cache. */
export function resetCommunityRatingCacheForTests() {
  ratingCache.clear()
  ratingInflight.clear()
}
