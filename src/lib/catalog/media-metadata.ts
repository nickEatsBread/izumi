import type { Media, MediaRating } from '$lib/anilist/types'

const SOURCE_LABELS: Record<string, string> = {
  anilist: 'AniList',
  kitsu: 'Kitsu',
  tmdb: 'TMDB',
  stremio: 'IMDb',
  jvm: 'Source',
}

export function ratingsFor(media: Media, embeddedScore?: number): MediaRating[] {
  if (media.ratings?.length) {
    return media.ratings.filter((rating) => Number.isFinite(rating.score) && rating.score >= 0 && rating.score <= rating.scale)
  }
  const score = embeddedScore != null ? embeddedScore * 10 : media.averageScore
  if (score == null || !Number.isFinite(score) || score <= 0) return []
  const source = embeddedScore != null
    ? 'Source'
    : SOURCE_LABELS[media.catalog?.provider ?? 'anilist'] ?? 'Rating'
  return [{ source, score, scale: 100 }]
}

export const ratingOutOfTen = (rating: MediaRating): number => rating.score * 10 / rating.scale

export function ratingLabel(rating: MediaRating): string {
  if (rating.scale === 100) return `${Math.round(rating.score)}%`
  return rating.scale === 5 ? `${rating.score.toFixed(1)}/5` : rating.score.toFixed(1)
}

export function compactRatingLabel(rating: MediaRating): string {
  return ratingOutOfTen(rating).toFixed(1)
}

export function compactVotes(value?: number): string {
  if (value == null || !Number.isFinite(value) || value < 0) return ''
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export const primaryRating = (media: Media): MediaRating | undefined => ratingsFor(media)[0]
