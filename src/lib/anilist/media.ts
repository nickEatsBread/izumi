import type { Media } from './types'

export const title = (m: Media) => m.title.userPreferred || m.title.english || m.title.romaji || 'TBA'

export const banner = (m: Media) =>
  m.bannerImage
  || (m.trailer?.id && (!m.trailer.site || m.trailer.site === 'youtube') ? `https://i.ytimg.com/vi/${m.trailer.id}/maxresdefault.jpg` : undefined)
  || m.coverImage?.extraLarge || m.coverImage?.medium || ''

export const cover = (m: Media) => m.coverImage?.extraLarge || m.coverImage?.medium || ''

const FORMATS: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' }
export const format = (m: Media) => (m.format ? FORMATS[m.format] ?? m.format : '')

const STATUS: Record<string, string> = { RELEASING: 'Releasing', NOT_YET_RELEASED: 'Not Yet Released', FINISHED: 'Finished', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
export const status = (m: Media) => (m.status ? STATUS[m.status] ?? m.status : '')

export const season = (m: Media) => (m.season && m.seasonYear ? `${m.season[0]}${m.season.slice(1).toLowerCase()} ${m.seasonYear}` : '')

export const ratingBg = (score?: number) => score == null ? 'bg-muted' : score >= 75 ? 'bg-green-700' : score >= 65 ? 'bg-orange-400' : 'bg-red-400'
