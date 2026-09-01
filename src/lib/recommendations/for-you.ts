import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import type { HistoryEntry } from '$lib/player/history'
import { anilistIdOf } from '$lib/catalog/identity'

const DAY = 24 * 60 * 60 * 1000
const MAX_DISMISSED = 300

export const dismissedForYouIds = persisted<number[]>('for-you-dismissed-v1', [])

export interface ForYouSeed {
  media: Media
  /** How strongly this title represents the viewer's taste, from 0 to 1. */
  affinity: number
}

export interface ForYouEdge {
  seedId: number
  rating?: number
  media: Media
}

export interface ForYouRecommendation {
  media: Media
  score: number
  reason: string
  sourceCount: number
}

/** Pick a small, privacy-safe seed set from durable on-device history. Incognito history is never
 * passed here. Recent titles and titles watched further through carry more signal than one-off
 * starts, while old favourites still retain a useful baseline weight. */
export function historySeeds(
  history: Record<number, HistoryEntry>,
  now = Date.now(),
  limit = 8,
): ForYouSeed[] {
  return Object.values(history)
    .flatMap((entry) => {
      const id = anilistIdOf(entry.media)
      if (!id) return []
      const total = Math.max(1, entry.media.episodes ?? Math.max(entry.episode, entry.progress, 12))
      const completion = Math.min(1, Math.max(entry.progress, entry.episode * 0.35) / total)
      const ageDays = Math.max(0, now - entry.updatedAt) / DAY
      const recency = Math.exp(-ageDays / 120)
      return [{
        media: { ...entry.media, id },
        affinity: clamp(0.42 + completion * 0.34 + recency * 0.24, 0, 1),
      }]
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, limit)
}

/** Convert an AniList account entry into the same normalized taste signal as local history. */
export function accountSeed(
  media: Media,
  score = 0,
  status?: string,
  progress = 0,
): ForYouSeed {
  const explicit = score > 0 ? clamp(score / 100, 0.35, 1) : 0.62
  const completion = media.episodes ? clamp(progress / media.episodes, 0, 1) : 0
  const statusBoost = status === 'COMPLETED' || status === 'REPEATING' ? 0.08 : completion * 0.05
  return { media, affinity: clamp(explicit + statusBoost, 0, 1) }
}

/** Rank recommendation edges against the user's weighted genre profile. This stays deterministic:
 * the same history and AniList response always produce the same row, avoiding a reshuffle on every
 * visit. Already-seen and explicitly dismissed titles are removed before scoring. */
export function rankForYou(
  seeds: ForYouSeed[],
  edges: ForYouEdge[],
  options: {
    excludedIds?: Iterable<number>
    dismissedIds?: Iterable<number>
    showAdult?: boolean
    limit?: number
  } = {},
): ForYouRecommendation[] {
  const seedById = new Map(seeds.map((seed) => [seed.media.id, seed]))
  const excluded = new Set(options.excludedIds ?? [])
  for (const seed of seeds) excluded.add(seed.media.id)
  const dismissed = new Set(options.dismissedIds ?? [])
  const genreWeights = tasteGenres(seeds)
  const candidates = new Map<number, { media: Media; signals: { seed: ForYouSeed; rating: number }[] }>()

  for (const edge of edges) {
    if (!edge.media || excluded.has(edge.media.id) || dismissed.has(edge.media.id)) continue
    if (!options.showAdult && edge.media.isAdult) continue
    const seed = seedById.get(edge.seedId)
    if (!seed) continue
    const candidate = candidates.get(edge.media.id) ?? { media: edge.media, signals: [] }
    candidate.signals.push({ seed, rating: Math.max(0, edge.rating ?? 0) })
    candidates.set(edge.media.id, candidate)
  }

  return [...candidates.values()].map(({ media, signals }) => {
    const strongest = signals.slice().sort((a, b) => signalStrength(b) - signalStrength(a))[0]
    const edgeScore = signals.reduce((sum, signal) => sum + signalStrength(signal), 0)
    const matchingGenres = (media.genres ?? [])
      .filter((genre) => genreWeights.has(genre))
      .sort((a, b) => (genreWeights.get(b) ?? 0) - (genreWeights.get(a) ?? 0))
    const totalGenreWeight = [...genreWeights.values()].reduce((sum, value) => sum + value, 0) || 1
    const genreScore = matchingGenres.reduce((sum, genre) => sum + (genreWeights.get(genre) ?? 0), 0) / totalGenreWeight
    const quality = clamp((media.averageScore ?? 60) / 100, 0, 1)
    const support = Math.log2(1 + signals.length)
    const score = edgeScore * 5 + genreScore * 2.2 + quality * 0.7 + support * 0.45
    const sourceTitle = displayTitle(strongest.seed.media)
    const reason = signals.length > 1
      ? `Inspired by ${sourceTitle} + ${signals.length - 1} more`
      : sourceTitle
        ? `Because you watched ${sourceTitle}`
        : matchingGenres.length
          ? `Matches your ${matchingGenres.slice(0, 2).join(' + ')} taste`
          : 'Picked for your watch history'
    return { media, score, reason, sourceCount: signals.length }
  })
    .sort((a, b) => b.score - a.score || (b.media.averageScore ?? 0) - (a.media.averageScore ?? 0) || a.media.id - b.media.id)
    .slice(0, options.limit ?? 20)
}

export function dismissForYou(mediaId: number) {
  dismissedForYouIds.update((ids) => [mediaId, ...ids.filter((id) => id !== mediaId)].slice(0, MAX_DISMISSED))
}

function signalStrength({ seed, rating }: { seed: ForYouSeed; rating: number }) {
  // AniList recommendation ratings have a long tail. log1p lets a strong community signal help
  // without allowing a single popular franchise to drown out every other taste seed.
  return seed.affinity * (1 + Math.log1p(rating) / 6)
}

function tasteGenres(seeds: ForYouSeed[]) {
  const weights = new Map<string, number>()
  for (const seed of seeds) {
    for (const genre of seed.media.genres ?? []) weights.set(genre, (weights.get(genre) ?? 0) + seed.affinity)
  }
  return weights
}

function displayTitle(media: Media) {
  return media.title.userPreferred ?? media.title.english ?? media.title.romaji ?? media.title.native ?? ''
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
