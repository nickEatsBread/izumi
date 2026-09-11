import type { Media } from '$lib/anilist/types'
import type { HistoryEntry } from '$lib/player/history'
import { anilistIdOf } from '$lib/catalog/identity'
import type { ForYouRecommendation } from './for-you'

/**
 * Local "Recommended for You" fallback — ranks the catalogs already installed on the device
 * against durable watch history, with no tracker account, no network and no framework import.
 * Purity mirrors docs/recommendations.md and the shared engine: no Svelte/store/network/global
 * clock at runtime (type-only imports are erased), and results are memoized per history identity
 * so a store update invalidates while a re-render never recomputes.
 *
 * The seed weighting mirrors `historySeeds` in for-you.ts (completion + recency) rather than
 * importing it: that module reaches `profiledPersisted`, which would drag the persisted-store
 * stack into this supposedly pure module's runtime graph.
 */
const DAY = 86_400_000
const SEED_LIMIT = 8
/** Defensive input cap. A few hundred candidates must score in single-digit milliseconds. */
const MAX_CANDIDATES = 600

export interface LocalForYouOptions {
  /** Tracker list ids (watched/planned) hidden in addition to on-device history. */
  excludedIds?: Iterable<number>
  dismissedIds?: Iterable<number>
  showAdult?: boolean
  /** Injectable clock for deterministic tests; production callers take the memoized default. */
  now?: number
  limit?: number
}

interface LocalSeed {
  media: Media
  /** 0..1 taste strength; same shape as ForYouSeed so both rankers read alike. */
  affinity: number
  /** 0..1 exp age decay; recency decides which seed a candidate is attributed to. */
  recency: number
}

export function localForYou(
  history: Record<number, HistoryEntry>,
  candidates: readonly Media[] | null | undefined,
  options: LocalForYouOptions = {},
): ForYouRecommendation[] {
  const pool = candidates ?? EMPTY_CANDIDATES
  const showAdult = options.showAdult ?? false
  const dismissed = options.dismissedIds
  const excluded = options.excludedIds

  let poolMemo = historyMemo.get(history)
  if (!poolMemo) { poolMemo = new WeakMap(); historyMemo.set(history, poolMemo) }
  const cached = poolMemo.get(pool)
  // Store-fed inputs (history, pool, dismissed list, tracker ids) each arrive as a fresh array /
  // object only when the underlying store actually emitted, so reference equality is a cheap and
  // exact staleness test — no JSON keys, no recompute on unrelated re-renders.
  if (cached && cached.showAdult === showAdult && cached.dismissed === dismissed && cached.excluded === excluded) {
    return cached.result
  }

  const result = rankLocal(pool, history, showAdult, dismissed, excluded, options)
  poolMemo.set(pool, { showAdult, dismissed, excluded, result })
  return result
}

const EMPTY_CANDIDATES: Media[] = []
const historyMemo = new WeakMap<object, WeakMap<object, {
  showAdult: boolean
  dismissed: unknown
  excluded: unknown
  result: ForYouRecommendation[]
}>>()

function rankLocal(
  pool: readonly Media[],
  history: Record<number, HistoryEntry>,
  showAdult: boolean,
  dismissedIds: Iterable<number> | undefined,
  excludedIds: Iterable<number> | undefined,
  options: LocalForYouOptions,
): ForYouRecommendation[] {
  const now = options.now ?? Date.now()
  const seeds = tasteSeeds(history, now, showAdult)
  if (!seeds.length) return [] // no taste data → the row stays hidden, exactly like the account path

  const profile = tasteProfile(seeds)
  const seen = new Set<number>()
  for (const seed of seeds) seen.add(seed.media.id)
  const excluded = collectIds(excludedIds, seen)
  const dismissed = collectIds(dismissedIds)

  const ranked: ForYouRecommendation[] = []
  // First occurrence wins on cross-catalog duplicates: the pool is already interleaved and
  // deduplicated by mediaKey, so order is deterministic and no scorer work is wasted.
  for (const candidate of pool.slice(0, MAX_CANDIDATES)) {
    const id = anilistIdOf(candidate) ?? candidate.id
    if (!candidate.title || seen.has(id) || excluded.has(id) || dismissed.has(id)) continue
    if (!showAdult && candidate.isAdult) continue
    seen.add(id)
    ranked.push(scoreCandidate(candidate, seeds, profile))
  }

  return ranked
    .sort((a, b) => b.score - a.score
      || (b.media.averageScore ?? 0) - (a.media.averageScore ?? 0)
      || a.media.id - b.media.id)
    .slice(0, options.limit ?? 20)
}

/** Mirrors the historySeeds affinity formula (completion + recency), see module comment. */
function tasteSeeds(history: Record<number, HistoryEntry>, now: number, showAdult: boolean): LocalSeed[] {
  return Object.values(history)
    .flatMap((entry) => {
      const id = anilistIdOf(entry.media)
      if (!id) return []
      if (!showAdult && entry.media.isAdult) return []
      const total = Math.max(1, entry.media.episodes ?? Math.max(entry.episode, entry.progress, 12))
      const completion = Math.min(1, Math.max(entry.progress, entry.episode * 0.35) / total)
      const ageDays = Math.max(0, now - entry.updatedAt) / DAY
      const recency = Math.exp(-ageDays / 120)
      return [{
        media: { ...entry.media, id },
        affinity: clamp(0.42 + completion * 0.34 + recency * 0.24, 0, 1),
        recency,
      }]
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, SEED_LIMIT)
}

interface TasteProfile {
  /** Affinity-weighted genre vector, normalized as ||v||₂ for the cosine below. */
  genres: Map<string, number>
  genreNorm: number
  /** Affinity mass per format (TV / MOVIE / ONA…), over total affinity. */
  formats: Map<string, number>
  totalAffinity: number
}

function tasteProfile(seeds: LocalSeed[]): TasteProfile {
  const genres = new Map<string, number>()
  const formats = new Map<string, number>()
  let totalAffinity = 0
  for (const seed of seeds) {
    totalAffinity += seed.affinity
    for (const genre of seed.media.genres ?? []) {
      const key = normalizeGenre(genre)
      genres.set(key, (genres.get(key) ?? 0) + seed.affinity)
    }
    if (seed.media.format) formats.set(seed.media.format, (formats.get(seed.media.format) ?? 0) + seed.affinity)
  }
  let squares = 0
  for (const weight of genres.values()) squares += weight * weight
  return { genres, genreNorm: Math.sqrt(squares) || 1, formats, totalAffinity: totalAffinity || 1 }
}

function scoreCandidate(candidate: Media, seeds: LocalSeed[], profile: TasteProfile): ForYouRecommendation {
  const candidateGenres = (candidate.genres ?? []).map(normalizeGenre)
  let dot = 0
  for (const genre of candidateGenres) dot += profile.genres.get(genre) ?? 0
  // Cosine between the candidate's binary genre vector and the weighted taste vector: length
  // differences between catalogs' genre vocabularies cannot inflate the score.
  const genreScore = candidateGenres.length ? dot / (profile.genreNorm * Math.sqrt(candidateGenres.length)) : 0

  // Recency-driven attribution: the seed a candidate most resembles — weighted toward what the
  // viewer watched LATEST — names the reason and lifts the score. Jaccard keeps catalogs that
  // tag everything generously from winning on raw overlap counts.
  let bestSeed: LocalSeed | undefined
  let bestStrength = 0
  for (const seed of seeds) {
    const strength = seedOverlap(candidateGenres, seed) * (0.35 + 0.65 * seed.recency) * seed.affinity
    if (strength > bestStrength) { bestStrength = strength; bestSeed = seed }
  }

  const formatScore = candidate.format ? (profile.formats.get(candidate.format) ?? 0) / profile.totalAffinity : 0
  const quality = clamp((candidate.averageScore ?? 60) / 100, 0, 1)
  // Popularity only breaks ties among equally-on-genre picks; log keeps blockbusters linear.
  const popularity = clamp(Math.log10((candidate.popularity ?? 0) + 1) / 6, 0, 1)
  const airing = candidate.nextAiringEpisode ? 1 : 0

  const score = genreScore * 2.6
    + bestStrength * 1.4
    + formatScore * 0.8
    + quality * 0.8
    + popularity * 0.25
    + airing * 0.15

  const matchingGenres = candidateGenres.filter((genre) => profile.genres.has(genre))
  const seedTitle = bestSeed ? displayTitle(bestSeed.media) : ''
  const reason = bestSeed && seedTitle && bestStrength > 0
    ? `Because you watched ${seedTitle}`
    : matchingGenres.length
      ? `Matches your ${matchingGenres.slice(0, 2).join(' + ')} taste`
      : 'Picked for your watch history'
  return { media: candidate, score, reason, sourceCount: bestSeed ? 1 : 0 }
}

function seedOverlap(candidateGenres: string[], seed: LocalSeed): number {
  const seedGenres = (seed.media.genres ?? []).map(normalizeGenre)
  if (!candidateGenres.length || !seedGenres.length) return 0
  const shared = new Set(candidateGenres.filter((genre) => seedGenres.includes(genre)))
  const union = new Set([...candidateGenres, ...seedGenres]).size
  return shared.size / union
}

/** Catalogs spell shared genres differently (e.g. TMDB "Science Fiction" vs AniList "Sci-Fi");
 * without folding the variants, cross-catalog affinity silently halves. */
function normalizeGenre(genre: string): string {
  const key = genre.trim().toLowerCase()
  return ['science fiction', 'sci fi', 'scifi', 'science-fiction'].includes(key) ? 'sci-fi' : key
}

function collectIds(values: Iterable<number> | undefined, into = new Set<number>()): Set<number> {
  if (values) for (const value of values) into.add(value)
  return into
}

function displayTitle(media: Media): string {
  return media.title.userPreferred ?? media.title.english ?? media.title.romaji ?? media.title.native ?? ''
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
