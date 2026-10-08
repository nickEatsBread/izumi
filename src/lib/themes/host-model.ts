import { banner, cardCover, cover, format, season, status, title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import type { EpMeta } from '$lib/anizip/types'
import type { Pos } from '$lib/player/progress'
import { compactCountdown, longCountdown } from './countdown'
import { episodeCodeText, episodeNameText } from './episode-fields'
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

/** A title's average score out of ten with one decimal ("8.6"); nothing for an unscored title. */
export function seriesRatingText(media: Pick<Media, 'averageScore'>): string | undefined {
  return media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined
}

/** A running time in words, as phone apps print it: "24 mins", "1 min", "1 hr", "1 hr 45 mins",
 *  "2 hrs". Nothing for a missing or non-positive length. */
export function durationLongText(minutes: number | null | undefined): string | undefined {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return undefined
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const rest = total % 60
  const mins = rest ? `${rest} ${rest === 1 ? 'min' : 'mins'}` : ''
  if (!hours) return mins
  return [`${hours} ${hours === 1 ? 'hr' : 'hrs'}`, mins].filter(Boolean).join(' ')
}

/** The first three characters' names, as a "Starring" line reads them ("Frieren, Fern, Stark"). The
 *  catalog lists main characters first. Nothing for a record without characters. */
export function starringText(media: Pick<Media, 'characters'>): string | undefined {
  const names = (media.characters?.edges ?? []).map((edge) => edge.node.name.full?.trim()).filter(Boolean).slice(0, 3)
  return names.length ? names.join(', ') : undefined
}

/** Every main studio, joined ("MADHOUSE, Studio X"); a provider's creator names when the record has
 *  no studios. Nothing when neither is known. */
export function creatorsText(media: Pick<Media, 'studios' | 'creators'>): string | undefined {
  const studios = (media.studios?.nodes ?? []).map((studio) => studio.name).filter(Boolean)
  const names = studios.length ? studios : media.creators ?? []
  return names.length ? names.join(', ') : undefined
}

/** The kind of title as streaming apps word it (`kind`): "Series" for TV, TV short and ONA, "Movie" for a
 *  film, "Special" for an OVA, a special or a music video. Nothing for a reading title or an unknown
 *  format. */
export function seriesKindText(format: string | null | undefined): string | undefined {
  switch (format) {
    case 'TV': case 'TV_SHORT': case 'ONA': return 'Series'
    case 'MOVIE': return 'Movie'
    case 'OVA': case 'SPECIAL': case 'MUSIC': return 'Special'
    default: return undefined
  }
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
  const score = extras.score ?? (media.averageScore || undefined)
  return {
    title: title(media),
    description: strip(media.description) || undefined,
    poster,
    backdrop,
    // The full-resolution portrait art: a host that looked up the TVDB poster passes it, every other
    // host binds the catalog cover at its largest size (never the card-sized one).
    posterHd: extras.posterHd ?? (cover(media) || poster),
    logo: extras.logo ?? media.logoImage ?? undefined,
    score,
    // The score alone ("81"), where `score` reads "81%".
    scoreValue: score != null ? String(score) : undefined,
    rating: seriesRatingText(media),
    format: format(media) || undefined,
    // "Series", "Movie" or "Special" (API 4), for a meta line that names the kind of title.
    kind: seriesKindText(media.format),
    // `year` is the season ("Fall 2023") for older templates; `startYear` is the year alone.
    year: season(media) || (media.startDate?.year ? String(media.startDate.year) : undefined),
    startYear: String(media.seasonYear ?? media.startDate?.year ?? '') || undefined,
    studio: media.studios?.nodes?.[0]?.name,
    // Every studio ("creators") and the first three characters ("starring"), for credit lines.
    creators: creatorsText(media),
    starring: starringText(media),
    season: season(media) || undefined,
    status: status(media) || undefined,
    genres: media.genres?.length ? media.genres.slice(0, 8).join(' · ') : undefined,
    genre: media.genres?.[0] || undefined,
    genre2: media.genres?.[1] || undefined,
    genre3: media.genres?.[2] || undefined,
    members: media.popularity ? compact.format(media.popularity) : undefined,
    episodeCount: media.episodes != null ? String(media.episodes) : undefined,
    duration: media.duration || undefined,
    // An episode host passes its own runtime as `duration`; the long form follows it.
    durationLong: durationLongText(extras.duration ?? media.duration),
    source: media.source ? media.source.replace(/_/g, ' ').toLowerCase() : undefined,
    country: ({ JP: 'Japan', KR: 'South Korea', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', US: 'United States' } as Record<string, string>)[media.countryOfOrigin ?? ''] ?? media.countryOfOrigin,
    nextEpisode: next?.episode || undefined,
    airingIn: airing && secondsLeft != null ? compactCountdown(secondsLeft) : undefined,
    airingCountdown: airing && secondsLeft != null ? longCountdown(secondsLeft) : undefined,
    // The countdown has run out but the catalog has not moved on to a newer episode yet: the next
    // episode is due ("EP 13 SOON") rather than unknown.
    airingSoon: next?.episode && secondsLeft != null && secondsLeft <= 0 ? 'Soon' : undefined,
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
    // An episode's `rating` is its own, never the series score: a template that shows it only when
    // present must stay empty for an unrated or unaired episode.
    rating: extras.rating,
    episodeTitle: extras.episodeTitle ?? meta?.title,
    // The title the host shows, when it is the episode's own (not an "Episode N" stand-in). A host
    // that hides the title (spoiler protection) passes `episodeName` itself, undefined included.
    episodeName: extras.episodeName ?? episodeNameText(ep, extras.episodeTitle ?? meta?.title),
    episodeNumber: ep,
    episodeNo: extras.episodeNo ?? String(ep),
    episodeCode: extras.episodeCode ?? episodeCodeText(ep, meta?.season, meta?.seasonEpisode),
    description: extras.description ?? (strip(meta?.overview) || undefined),
    duration: extras.duration ?? meta?.runtime ?? media.duration ?? undefined,
    airDate: extras.airDate ?? meta?.airDate,
    still: extras.still ?? meta?.image,
    ...extras,
  })
}

/** "21m left" for an episode that has been started; nothing before it starts, without a duration,
 *  or once its position was cleared. */
export function timeLeftLabel(position?: Pos): string | undefined {
  if (!position || position.cleared || !(position.dur > 0) || !(position.pos > 0)) return undefined
  return `${Math.max(1, Math.round((position.dur - position.pos) / 60))}m left`
}
