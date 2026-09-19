import { banner, cardCover, cover, format, season, status, title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import type { EpMeta } from '$lib/anizip/types'
import type { DisplayModel } from './presentation'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function strip(value?: string): string {
  return (value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/** Shared host bindings so every surface formats score, duration and artwork the same way. */
export function mediaDisplayModel(media: Media, extras: Partial<DisplayModel> = {}, coverWidth = 0): DisplayModel {
  const poster = extras.poster ?? ((coverWidth ? cardCover(media, coverWidth) : cover(media)) || undefined)
  const backdrop = extras.backdrop ?? (banner(media) || poster)
  return {
    title: title(media),
    description: strip(media.description) || undefined,
    poster,
    backdrop,
    logo: extras.logo ?? media.logoImage ?? undefined,
    score: media.averageScore || undefined,
    format: format(media) || undefined,
    year: season(media) || (media.startDate?.year ? String(media.startDate.year) : undefined),
    studio: media.studios?.nodes?.[0]?.name,
    season: season(media) || undefined,
    status: status(media) || undefined,
    genres: media.genres?.length ? media.genres.slice(0, 8).join(' · ') : undefined,
    members: media.popularity ? compact.format(media.popularity) : undefined,
    episodeCount: media.episodes != null ? String(media.episodes) : undefined,
    duration: media.duration || undefined,
    ...extras,
  }
}

export function episodeDisplayModel(
  media: Media,
  ep: number,
  meta?: EpMeta,
  extras: Partial<DisplayModel> = {},
): DisplayModel {
  return mediaDisplayModel(media, {
    episodeTitle: extras.episodeTitle ?? meta?.title,
    episodeNumber: ep,
    description: extras.description ?? (strip(meta?.overview) || undefined),
    duration: extras.duration ?? meta?.runtime ?? media.duration ?? undefined,
    airDate: extras.airDate ?? meta?.airDate,
    still: extras.still ?? meta?.image,
    ...extras,
  })
}
