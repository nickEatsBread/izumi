// The standard series facts (type, episodes, status, dates, season, runtime, studio, source,
// country, score, audience) as label/value pairs, for the table, card and chip fact styles.
import { format, season, seasonBrowseHref, status, totalEpisodes } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'

export interface MediaFact {
  key: string
  label: string
  value: string
  href?: string
  /** Several destinations for one fact (e.g. one link per genre), rendered comma-separated
   * instead of the single `href` above. */
  links?: { text: string; href: string }[]
}

export const prettyEnum = (value?: string | null): string => value
  ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
  : ''

export const countryName = (code?: string | null): string =>
  ({ JP: 'Japan', CN: 'China', KR: 'South Korea', TW: 'Taiwan' } as Record<string, string>)[code ?? ''] ?? code ?? ''

export const formatDate = (date?: { year?: number | null; month?: number | null; day?: number | null } | null): string =>
  date?.year ? [date.year, date.month, date.day].filter(Boolean).join('-') : ''

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function mediaFacts(m: Media): MediaFact[] {
  const facts: MediaFact[] = []
  const add = (key: string, label: string, value: string | undefined, href?: string) => {
    if (value) facts.push({ key, label, value, ...(href ? { href } : {}) })
  }
  const episodes = totalEpisodes(m)
  const studio = m.studios?.nodes?.[0]
  add('format', 'Type', format(m))
  add('episodes', 'Episodes', episodes ? String(episodes) : '')
  add('status', 'Status', status(m))
  // The detail queries fetch the start date only.
  add('aired', 'Aired', formatDate(m.startDate))
  add('season', 'Season', season(m), season(m) ? seasonBrowseHref(m) : undefined)
  add('duration', 'Duration', m.duration ? `${m.duration} min` : '')
  add('studio', 'Studio', studio?.name, studio ? (studio.id ? `/app/studio/${studio.id}` : `/app/search?search=${encodeURIComponent(studio.name)}`) : undefined)
  add('source', 'Source', prettyEnum(m.source))
  add('country', 'Country', countryName(m.countryOfOrigin))
  add('score', 'Score', m.averageScore ? `${m.averageScore}%` : '')
  add('members', 'Members', m.popularity ? compactNumber.format(m.popularity) : '')
  // A non-template facts style (table/cards/chips) otherwise dropped genres entirely — the
  // template meta line was the only place that showed them. One fact carrying a link per genre
  // keeps them just as reachable as before, comma-separated instead of a wrapping chip rail.
  if (m.genres?.length) {
    facts.push({
      key: 'genres',
      label: 'Genres',
      value: m.genres.join(', '),
      links: m.genres.map((genre) => ({ text: genre, href: `/app/search?genre=${encodeURIComponent(genre)}` })),
    })
  }
  return facts
}
