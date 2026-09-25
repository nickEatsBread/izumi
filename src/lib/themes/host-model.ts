import { banner, cardCover, cover, format, season, status, title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import type { EpMeta } from '$lib/anizip/types'
import { compactCountdown, longCountdown } from './countdown'
import type { DisplayModel } from './presentation'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function strip(value?: string): string {
  let sanitized = value ?? ''
  let previous: string
  do {
    previous = sanitized
    sanitized = sanitized.replace(/<[^>]*>/g, '')
  } while (sanitized !== previous)
  return sanitized.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

/** Shared host bindings so every surface formats score, duration and artwork the same way.
 *  `now` lets a live surface (the hero clock) re-derive the countdown without refetching. */
export function mediaDisplayModel(media: Media, extras: Partial<DisplayModel> = {}, coverWidth = 0, now = Date.now()): DisplayModel {
  const poster = extras.poster ?? ((coverWidth ? cardCover(media, coverWidth) : cover(media)) || undefined)
  const backdrop = extras.backdrop ?? (banner(media) || poster)
  const next = media.nextAiringEpisode
  const secondsLeft = next ? (next.airingAt ? next.airingAt - Math.floor(now / 1000) : next.timeUntilAiring) : undefined
  const airing = secondsLeft != null && secondsLeft > 0
  const aired = media.airedEpisodes ?? (next?.episode ? next.episode - 1 : media.status === 'FINISHED' ? media.episodes ?? undefined : undefined)
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
    source: media.source ? media.source.replace(/_/g, ' ').toLowerCase() : undefined,
    country: ({ JP: 'Japan', KR: 'South Korea', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', US: 'United States' } as Record<string, string>)[media.countryOfOrigin ?? ''] ?? media.countryOfOrigin,
    nextEpisode: next?.episode || undefined,
    airingIn: airing && secondsLeft != null ? compactCountdown(secondsLeft) : undefined,
    airingCountdown: airing && secondsLeft != null ? longCountdown(secondsLeft) : undefined,
    episodesAired: aired,
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
