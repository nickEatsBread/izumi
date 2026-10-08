// The standard series facts (type, episodes, status, dates, season, runtime, studio, source,
// country, score, audience, and the API 4 year, end date, favourites, author and the romaji, English
// and native titles) as label/value
// pairs, for the table, card and chip fact styles and the phone Information grid. A theme picks
// which show and in what order (`detail.factsKeys`, `infoKeys`), renames them from a fixed list
// (`factsLabels`) and sets how scores, dates and counts read (`factsFormat`).
import { airedCount, format, season, seasonBrowseHref, status, totalEpisodes } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import { FACT_LABEL_TEXT, FACT_LABELS, type FactKey, type FactLabel, type FactsFormat } from '$lib/themes/presentation'
import { durationLongText } from '$lib/themes/host-model'

export interface MediaFact {
  key: FactKey
  label: string
  value: string
  href?: string
  /** Several destinations for one fact (e.g. one link per genre), rendered comma-separated
   * instead of the single `href` above. */
  links?: { text: string; href: string }[]
  /** Text after the value in a part of its own (`fact.suffix`): " / 10" after a `ten-of` score. */
  suffix?: string
  /** The page is still loading and its record does not say yet: the value is a placeholder. */
  pending?: boolean
}

export interface FactOptions {
  /** The facts shown, in order (`detail.factsKeys`, `detail.infoKeys`). Without it, izumi's own set. */
  keys?: readonly FactKey[]
  /** A replacement name per fact (`detail.factsLabels`). */
  labels?: Partial<Record<FactKey, FactLabel>>
  /** How scores, dates and counts read (`detail.factsFormat`). */
  format?: FactsFormat
  /** `info` is the phone Information grid. Without `keys` it keeps that grid's own facts and wording
   *  ("Runtime", "Premiered", "184,000 members", every studio, "Unknown" episodes). */
  place?: 'facts' | 'info'
  /** The viewer's progress ("3/12"), shown as the `progress` fact. */
  progress?: string
  /** The page is still loading: a fact the record cannot fill yet comes back as a placeholder
   *  instead of being left out (or reading "Unknown"). */
  pending?: boolean
}

export const prettyEnum = (value?: string | null): string => value
  ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
  : ''

export const countryName = (code?: string | null): string =>
  ({ JP: 'Japan', CN: 'China', KR: 'South Korea', TW: 'Taiwan' } as Record<string, string>)[code ?? ''] ?? code ?? ''

type PartialDate = { year?: number | null; month?: number | null; day?: number | null } | null | undefined

export const formatDate = (date?: PartialDate): string =>
  date?.year ? [date.year, date.month, date.day].filter(Boolean).join('-') : ''

/** A date as `factsFormat.dates` asks: "2026-1-1" (`numeric`), or the viewer's locale, "1/1/2026"
 *  (`short`) or "1 January 2026" (`long`). A date known only to the month or the year keeps those. */
export function factDate(date: PartialDate, style: FactsFormat['dates'] = 'numeric'): string {
  if (!date?.year) return ''
  if (style === 'numeric') return formatDate(date)
  if (!date.month) return String(date.year)
  const month = style === 'long' ? 'long' : 'numeric'
  const day = date.day ? { day: 'numeric' as const } : {}
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month, ...day, timeZone: 'UTC' })
    .format(new Date(Date.UTC(date.year, date.month - 1, date.day || 1)))
}

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const fullNumber = new Intl.NumberFormat(undefined)
const count = (value: number, style: FactsFormat['counts'] = 'compact') => (style === 'raw' ? String(value) : (style === 'full' ? fullNumber : compactNumber).format(value))

/** A running time as `factsFormat.duration` asks: "24 mins", "1 hr 45 mins" (`long`), "24m", "1h 45m"
 *  (`short`), "24 min" (`min`); without it izumi's own, "24 min", or "24 minutes" in the Information
 *  grid's own wording (`own`). */
export function factDuration(minutes: number | null | undefined, style?: FactsFormat['duration'], own = false): string {
  if (!minutes) return ''
  if (style === 'long') return durationLongText(minutes) ?? ''
  if (style === 'short') {
    const total = Math.round(minutes)
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`
  }
  return `${minutes} ${own && !style ? 'minutes' : 'min'}`
}

/** izumi's own facts, in reading order (the progress line first, when there is progress). */
const FACTS_KEYS: readonly FactKey[] = ['progress', 'format', 'episodes', 'status', 'aired', 'season', 'duration', 'studio', 'source', 'country', 'score', 'members', 'genres']
/** The phone Information grid's own facts. */
export const INFO_KEYS: readonly FactKey[] = ['studio', 'format', 'status', 'episodes', 'duration', 'season', 'aired', 'source', 'country', 'score', 'members']
/** The Information grid's own names, where they differ from the facts' ("Format" rather than "Type"). */
const INFO_LABELS: Partial<Record<FactKey, FactLabel>> = { format: 'format', duration: 'runtime', aired: 'premiered', members: 'popularity' }

/** A studio's page, or a search for it when the catalog gives it no id. */
export const studioHref = (studio: { id?: number; name: string }) => (studio.id ? `/app/studio/${studio.id}` : `/app/search?search=${encodeURIComponent(studio.name)}`)

const PLAIN_STATUS: Record<string, string> = { RELEASING: 'Ongoing', FINISHED: 'Completed', HIATUS: 'Hiatus', CANCELLED: 'Cancelled' }
/** A title's status as `factsFormat.status` asks: the catalog's word ("Releasing", "Finished"), or
 *  under `plain` "Ongoing", "Completed", "Hiatus" or "Cancelled", and nothing for a title not out yet
 *  (or a status the catalog does not name). */
export function statusText(m: Pick<Media, 'status'>, style: FactsFormat['status'] = 'catalog'): string {
  if (style !== 'plain') return status(m as Media)
  return PLAIN_STATUS[m.status ?? ''] ?? ''
}

/** The episodes fact as `factsFormat.episodes` asks: the episode count (`total`), or while the title
 *  airs the episodes aired so far (`aired`), followed under `aired-of` by " / " and the catalog's
 *  planned total, "?" when it has none ("1147 / ?"). A title that is not airing, or whose aired count
 *  is unknown, reads its total. */
export function episodesFact(m: Media, style: FactsFormat['episodes'] = 'total'): { value: string; suffix?: string } {
  const total = totalEpisodes(m)
  const aired = airedCount(m)
  if (style !== 'total' && (m.status === 'RELEASING' || m.status === 'HIATUS') && Number.isFinite(aired) && aired > 0) {
    return { value: String(aired), suffix: style === 'aired-of' ? ` / ${m.episodes || '?'}` : undefined }
  }
  return { value: total ? String(total) : '' }
}
// Staff pages exist for AniList's records only.
const staffHref = (m: Media, id: number) => (!m.catalog || m.catalog.provider === 'anilist' ? `/app/staff/${id}` : undefined)
/** The credit AniList gives the original author ("Original Creator", "Original Story"). */
const AUTHOR_ROLE = /^original (creator|story)\b/i
const finished = (m: Media) => m.status !== 'RELEASING' && m.status !== 'NOT_YET_RELEASED'

/** The facts `options.keys` asks for (izumi's own set without it), in that order. A fact without a
 *  value is left out, unless the page is still loading (`pending`). */
export function mediaFacts(m: Media, options: FactOptions = {}): MediaFact[] {
  const info = options.place === 'info'
  const own = info && !options.keys
  const formatting = options.format ?? {}
  const keys = options.keys ?? (info ? INFO_KEYS : FACTS_KEYS)
  const labels = { ...(own ? INFO_LABELS : {}), ...options.labels }
  const label = (key: FactKey) => {
    const name = labels[key]
    return FACT_LABEL_TEXT[name && FACT_LABELS[key].includes(name) ? name : FACT_LABELS[key][0]]
  }
  const studios = m.studios?.nodes ?? []
  const facts: MediaFact[] = []
  for (const key of keys) {
    const fact: MediaFact = { key, label: label(key), value: '' }
    switch (key) {
      case 'progress':
        fact.value = options.progress ?? ''
        break
      case 'format':
        fact.value = format(m)
        break
      case 'episodes': {
        const episodes = episodesFact(m, formatting.episodes)
        fact.value = episodes.value || (own && !options.pending ? 'Unknown' : '')
        if (episodes.suffix) fact.suffix = episodes.suffix
        break
      }
      case 'status':
        fact.value = statusText(m, formatting.status)
        break
      case 'aired':
        fact.value = factDate(m.startDate, formatting.dates)
        break
      case 'ended':
        // A title still airing (or not yet out) has no end date, whatever the catalog plans.
        if (!finished(m)) continue
        fact.value = factDate(m.endDate, formatting.dates)
        break
      case 'year': {
        const year = m.seasonYear ?? m.startDate?.year
        fact.value = year ? String(year) : ''
        break
      }
      case 'season':
        fact.value = season(m)
        if (fact.value) fact.href = seasonBrowseHref(m)
        break
      case 'duration':
        fact.value = factDuration(m.duration, formatting.duration, own)
        break
      case 'romaji':
      case 'english':
      case 'native':
        fact.value = m.title?.[key] ?? ''
        break
      case 'studio':
        if (own) {
          // The grid names every main studio.
          fact.value = studios.map((studio) => studio.name).join(', ')
          if (studios.length) fact.links = studios.map((studio) => ({ text: studio.name, href: studioHref(studio) }))
        } else if (studios[0]) {
          fact.value = studios[0].name
          fact.href = studioHref(studios[0])
        }
        break
      case 'author': {
        const credits = (m.staff?.edges ?? []).filter((edge) => AUTHOR_ROLE.test(edge.role) && edge.node.name.full)
        const people = [...new Map(credits.map((edge) => [edge.node.id, edge.node])).values()]
        if (people.length) {
          fact.value = people.map((person) => person.name.full).join(', ')
          const links = people.flatMap((person) => {
            const href = staffHref(m, person.id)
            return href ? [{ text: person.name.full!, href }] : []
          })
          if (links.length === people.length) fact.links = links
        } else {
          fact.value = (m.creators ?? []).join(', ')
        }
        break
      }
      case 'source':
        fact.value = prettyEnum(m.source)
        break
      case 'country':
        fact.value = countryName(m.countryOfOrigin)
        break
      case 'score':
        if (m.averageScore) {
          const score = formatting.score ?? 'percent'
          fact.value = score === 'percent' ? `${m.averageScore}%` : (m.averageScore / 10).toFixed(1)
          if (score === 'ten-of') fact.suffix = ' / 10'
        }
        break
      case 'members':
        if (m.popularity) fact.value = own ? `${count(m.popularity, formatting.counts ?? 'full')} members` : count(m.popularity, formatting.counts)
        break
      case 'favourites':
        if (m.favourites) fact.value = count(m.favourites, formatting.counts)
        break
      case 'genres':
        // A non-template facts style (table/cards/chips) otherwise dropped genres entirely — the
        // template meta line was the only place that showed them. One fact carrying a link per genre
        // keeps them just as reachable as before, comma-separated instead of a wrapping chip rail.
        if (m.genres?.length) {
          fact.value = m.genres.join(', ')
          fact.links = m.genres.map((genre) => ({ text: genre, href: `/app/search?genre=${encodeURIComponent(genre)}` }))
        }
        break
    }
    if (fact.value) facts.push(fact)
    // The viewer's progress is the page's own, never the record's: nothing to wait for.
    else if (options.pending && key !== 'progress') facts.push({ key, label: fact.label, value: '', pending: true })
  }
  return facts
}
