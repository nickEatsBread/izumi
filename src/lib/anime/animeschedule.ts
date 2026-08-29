import { phttp } from '$lib/net/http'
import { del, get, set } from 'idb-keyval'
import type { Media } from '$lib/anilist/types'
import type { Airing } from '$lib/anilist/schedule'
import { fetchKitsuScheduleIndex } from '$lib/anilist/kitsu-catalog'

// AnimeSchedule's airing metadata — the things AniList carries no field for at all: whether a show
// is sitting out a cour break or has slipped a week, and the separate sub / dub release slots.
//
// The read endpoints used here (`/anime/{route}` and `/anime?q=`) are unauthenticated, so nothing
// in this module needs a key; the `/timetables/*` endpoints answer 401 and are deliberately not
// touched. The host does reject non-browser user agents with a 403, which the pooled Rust client
// already satisfies — another reason these calls must not go through the plugin's fetch.
//
// Every entry point resolves to `null` instead of throwing. This is a pure overlay: when the
// lookup misses or the network is down the caller renders its AniList-driven UI unchanged.

const API = 'https://animeschedule.net/api/v3/anime'
const TIMEOUT_MS = 8000

/** The subset of the anime payload this module reads, typed off the live response. */
export interface RawAnime {
  route?: string
  title?: string
  status?: string
  names?: { romaji?: string; english?: string; native?: string }
  websites?: { aniList?: string; mal?: string }
  description?: string
  year?: number
  season?: { season?: string; year?: string }
  genres?: { name?: string }[]
  studios?: { name?: string }[]
  sources?: { name?: string }[]
  mediaTypes?: { name?: string }[]
  episodes?: number
  lengthMin?: number
  imageVersionRoute?: string
  posterDominantColor?: string
  stats?: { averageScore?: number; trackedCount?: number }
  delayedTimetable?: string
  delayedFrom?: string
  delayedUntil?: string
  subDelayedFrom?: string
  subDelayedUntil?: string
  dubDelayedTimetable?: string
  dubDelayedFrom?: string
  dubDelayedUntil?: string
  jpnTime?: string
  subTime?: string
  dubTime?: string
}

export type DelayKind = 'break' | 'delayed'
/** A delay window that is in effect right now. `until` is null for an open-ended hiatus. */
export interface Delay { kind: DelayKind; from: number | null; until: number | null }

/** Normalized overlay for one title. All times are epoch ms; the UI formats them in local time. */
export interface ScheduleInfo {
  route: string
  /** Japanese broadcast delay. */
  delay: Delay | null
  /** Subtitled-release delay, when it slips independently of the broadcast. */
  subDelay: Delay | null
  /** Dub-release delay. */
  dubDelay: Delay | null
  /** Recurring broadcast / sub / dub slots. */
  jpnAt: number | null
  subAt: number | null
  dubAt: number | null
  finished: boolean
}

// Every timestamp field is present even when it holds nothing, carrying Go's zero time. The API
// has emitted both ISO (`0001-01-01...`) and day-first (`01/01/0001 ...`) forms over time. Parsed
// naively either can become a real date, which would put half the catalogue on an ancient delay.
const ZERO_TIME = /^(?:0001-01-01|01\/01\/0001)/

// Current responses use this culture-specific form even though older payloads were ISO. Browsers
// do not consistently parse it, and the first component is unambiguously the day once it exceeds
// 12. Treat it as UTC, matching the API's older timestamps and the release-slot semantics below.
const DAY_FIRST_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/

/** Epoch ms for an API timestamp, or null when it is unset or unparseable. */
export function parseTime(value?: string): number | null {
  if (!value || ZERO_TIME.test(value)) return null
  const dayFirst = DAY_FIRST_TIME.exec(value.trim())
  if (dayFirst) {
    const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', secondText = '0', msText = '0'] = dayFirst
    const [day, month, year, hour, minute, second, millisecond] = [
      dayText, monthText, yearText, hourText, minuteText, secondText, msText.padEnd(3, '0'),
    ].map(Number)
    const date = new Date(0)
    date.setUTCFullYear(year, month - 1, day)
    date.setUTCHours(hour, minute, second, millisecond)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
      || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null
    return date.getTime()
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// 'On Break' and 'Cour Break' are a planned gap between cours; 'Delayed' is a one-off slip. The
// field is absent entirely when nothing is wrong.
const delayKind = (timetable?: string): DelayKind => (/break/i.test(timetable ?? '') ? 'break' : 'delayed')

// A window is often published before it begins. A one-week slip is worth saying early — "next
// week's episode is skipped" is the only warning the viewer gets, and the episode airing this week
// still airs. A cour break is not: the UI states it as a fact ("On break until Jan 5"), so
// announcing a three-month pause in advance reads as "this show is not on right now" while it is
// airing normally. Length is what separates the two; the timetable wording doesn't (a seven-day
// new-year gap is filed as "On Break" too).
const ANNOUNCE_AHEAD_MS = 14 * 864e5

/** A delay window, but only while it is actually running.
 *
 *  AnimeSchedule keeps the LAST window on a title forever: a show that finished in 2024 still
 *  reports "On Break" with dates from the winter it paused. Rendering the raw fields would mark
 *  most of the catalogue as on hiatus, so a window counts only if it has not ended yet. */
export function activeDelay(
  timetable: string | undefined,
  from: string | undefined,
  until: string | undefined,
  now: number,
  finished: boolean,
): Delay | null {
  if (finished) return null
  const start = parseTime(from)
  const end = parseTime(until)
  if (end != null) {
    if (end <= now) return null
    if (start != null && start > now && end - start > ANNOUNCE_AHEAD_MS) return null
    return { kind: delayKind(timetable), from: start, until: end }
  }
  // A hiatus with no announced return date leaves `until` at the zero time, so a window that has
  // started and never been given an end is still in effect.
  return start != null && start <= now ? { kind: delayKind(timetable), from: start, until: null } : null
}

/** Fold a raw payload into the overlay shape. Returns null for a body with no route — a 200 with
 *  something unexpected in it is a miss, not an empty overlay. */
export function normalize(raw: RawAnime | undefined, now: number = Date.now()): ScheduleInfo | null {
  if (!raw?.route) return null
  const finished = /finished/i.test(raw.status ?? '')
  return {
    route: raw.route,
    delay: activeDelay(raw.delayedTimetable, raw.delayedFrom, raw.delayedUntil, now, finished),
    // There is no `subDelayedTimetable` in the API, only the pair of dates, so a sub slip inherits
    // the broadcast's wording: on break when the broadcast is, a plain delay otherwise.
    subDelay: activeDelay(raw.delayedTimetable, raw.subDelayedFrom, raw.subDelayedUntil, now, finished),
    dubDelay: activeDelay(raw.dubDelayedTimetable, raw.dubDelayedFrom, raw.dubDelayedUntil, now, finished),
    jpnAt: parseTime(raw.jpnTime),
    subAt: parseTime(raw.subTime),
    dubAt: parseTime(raw.dubTime),
    finished,
  }
}

// ── Presentation ─────────────────────────────────────────────────────────────
// Formatting lives here rather than in the components so the timezone conversion is covered by
// tests, and so the detail view and the schedule page can't drift apart.

const WEEK_MS = 7 * 864e5

/** Weekday + clock time for a slot in the viewer's local zone ("Sat 15:00"). The absolute date on
 *  these fields is the most recent airing, so only the recurring slot it encodes is meaningful.
 *
 *  That stored instant is routinely MONTHS old even on an ongoing show (One Piece's `subTime` is the
 *  start of the current cour, not last week), so formatting it directly bakes in the UTC offset that
 *  was in effect back then — an hour out, and occasionally a whole weekday out, once the viewer's
 *  zone has crossed a DST boundary since. Roll the weekly slot forward to its next occurrence and
 *  format that instead: Japan has no DST, so whole weeks preserve the broadcast wall-clock while the
 *  local offset comes out right for today. */
export const nextOccurrence = (at: number, now: number): number =>
  at < now ? at + Math.ceil((now - at) / WEEK_MS) * WEEK_MS : at

export function slotLabel(at: number | null, now: number = Date.now()): string {
  if (at == null) return ''
  const d = new Date(nextOccurrence(at, now))
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** Local calendar day for the end of a window ("Jan 5"). Matches the schedule page's range label. */
export const dayLabel = (at: number | null): string =>
  at == null ? '' : new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })

/** One short line for a delay — "On break", "Sub delayed until Jul 12", "Dub on break until Jan 5". */
export function delayLabel(delay: Delay | null, what: '' | 'Sub' | 'Dub' = ''): string {
  if (!delay) return ''
  const state = delay.kind === 'break' ? 'on break' : 'delayed'
  const head = what ? `${what} ${state}` : state.charAt(0).toUpperCase() + state.slice(1)
  const end = dayLabel(delay.until)
  return end ? `${head} until ${end}` : head
}

const sameWindow = (a: Delay | null, b: Delay | null) => !!a && !!b && a.from === b.from && a.until === b.until

/** Delay lines for the UI, most significant first: a broadcast slip gates everyone, a dub-only one
 *  gates fewer people. Empty when nothing is delayed, which is the overwhelmingly common case. */
export function delayLines(info: ScheduleInfo | null): string[] {
  if (!info) return []
  const lines: string[] = []
  if (info.delay) lines.push(delayLabel(info.delay))
  // A broadcast delay usually leaves the sub fields unset, but when both are filled with the same
  // window they describe one event and would otherwise print twice.
  if (info.subDelay && !sameWindow(info.subDelay, info.delay)) lines.push(delayLabel(info.subDelay, 'Sub'))
  if (info.dubDelay) lines.push(delayLabel(info.dubDelay, 'Dub'))
  return lines
}

/** Release-slot lines in local time ("Dub airs Wed 20:30"). Empty once a show has finished, where
 *  the stored slot is just the date of the last episode. */
export function slotLines(info: ScheduleInfo | null): string[] {
  if (!info || info.finished) return []
  return [
    info.subAt != null ? `Sub airs ${slotLabel(info.subAt)}` : '',
    info.dubAt != null ? `Dub airs ${slotLabel(info.dubAt)}` : '',
  ].filter(Boolean)
}

// ── Route resolution ─────────────────────────────────────────────────────────

/** Numeric AniList id out of the `websites.aniList` permalink ("anilist.co/anime/154587/Slug/"). */
export function anilistIdOf(raw: RawAnime): number | null {
  const m = /anilist\.co\/anime\/(\d+)/i.exec(raw.websites?.aniList ?? '')
  return m ? Number(m[1]) : null
}

const malIdOf = (raw: RawAnime): number | undefined => {
  const match = /myanimelist\.net\/anime\/(\d+)/i.exec(raw.websites?.mal ?? '')
  return match ? Number(match[1]) : undefined
}

/** Convert AnimeSchedule's public anime record to the card shape already used by the schedule UI. */
export function mapAnimeScheduleMedia(raw: RawAnime): Media | null {
  const id = anilistIdOf(raw)
  if (id == null) return null
  const image = raw.imageVersionRoute
    ? `https://img.animeschedule.net/production/assets/public/img/${raw.imageVersionRoute}`
    : undefined
  const format = raw.mediaTypes?.[0]?.name?.toUpperCase().replaceAll(' ', '_')
  const status = /ongoing/i.test(raw.status ?? '') ? 'RELEASING'
    : /finished/i.test(raw.status ?? '') ? 'FINISHED'
      : 'NOT_YET_RELEASED'
  return {
    __typename: 'Media', id, idMal: malIdOf(raw), type: 'ANIME',
    title: {
      __typename: 'MediaTitle', romaji: raw.names?.romaji ?? raw.title,
      english: raw.names?.english, native: raw.names?.native,
      userPreferred: raw.names?.english ?? raw.names?.romaji ?? raw.title,
    },
    description: raw.description,
    season: raw.season?.season?.toUpperCase(),
    seasonYear: Number(raw.season?.year ?? raw.year) || undefined,
    format, status, episodes: raw.episodes, duration: raw.lengthMin,
    averageScore: raw.stats?.averageScore == null ? undefined : Math.round(raw.stats.averageScore),
    popularity: raw.stats?.trackedCount,
    genres: raw.genres?.flatMap((genre) => genre.name ? [genre.name] : []),
    studios: { __typename: 'StudioConnection', nodes: raw.studios?.flatMap((studio) => studio.name ? [{ __typename: 'Studio', name: studio.name }] : []) ?? [] },
    coverImage: { __typename: 'MediaCoverImage', extraLarge: image, large: image, medium: image, color: raw.posterDominantColor },
  } as Media
}

interface TimetableCard { route: string; title: string; episode: number; airingAt: number }

/** ISO week understood by AnimeSchedule's public weekly page. */
export function isoWeek(atSeconds: number): { year: number; week: number } {
  const local = new Date(atSeconds * 1000)
  const date = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()))
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const year = date.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  return { year, week: 1 + Math.round((date.getTime() - firstThursday.getTime()) / WEEK_MS) }
}

export function parseTimetable(html: string, start: number, end: number): TimetableCard[] {
  // Slice at each outer card instead of matching nested HTML with one regex. The attributes and
  // <time> we need all occur before the following card and contain no encoded free-form text.
  const starts = [...html.matchAll(/<div\b[^>]*class="[^"]*\btimetable-column-show\b[^"]*"[^>]*>/gi)]
  const seen = new Set<string>()
  return starts.flatMap((match, index) => {
    const card = html.slice(match.index, starts[index + 1]?.index ?? html.length)
    if (!/\bairtype="raw"/i.test(card)) return []
    const route = /\broute="([^"]+)"/i.exec(match[0])?.[1] ?? ''
    const encodedTitle = /<h2\b[^>]*class="[^"]*\bshow-title-bar\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i.exec(card)?.[1] ?? ''
    const title = encodedTitle.replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, decimal) => String.fromCodePoint(Number(decimal)))
      .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").trim()
    const episode = Number(/\bairedepisode="(\d+)"/i.exec(match[0])?.[1])
    // AnimeSchedule HTML-encodes the `+` in timezone offsets (`&#43;01:00`). Passing that
    // string straight to Date.parse yields NaN, which silently filtered every otherwise-valid
    // weekly card out of the fallback schedule.
    const datetime = /<time\b[^>]*\bdatetime="([^"]+)"/i.exec(card)?.[1]
      ?.replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, decimal) => String.fromCodePoint(Number(decimal)))
      .replace(/&amp;/gi, '&')
    const airingAt = datetime ? Math.floor(Date.parse(datetime) / 1000) : NaN
    const key = `${route}:${episode}:${airingAt}`
    if (!route || !title || !Number.isFinite(episode) || episode < 1 || !Number.isFinite(airingAt)
      || airingAt < start || airingAt >= end || seen.has(key)) return []
    seen.add(key)
    return [{ route, title, episode, airingAt }]
  })
}

const SEASON_INDEX_TTL = 6 * 3600e3
const seasonIndexKey = (year: number, season: string) => `animeschedule-season-${year}-${season}-v1`

async function fetchSeasonPage(year: number, season: string, page: number): Promise<SearchPage | null> {
  try {
    const response = await phttp(`${API}?years=${year}&seasons=${season}&st=popularity&page=${page}`, {
      timeoutMs: 12_000, maxBytes: 4 * 1024 * 1024, background: true,
    })
    if (!response.ok) return null
    return (await response.json()) as SearchPage
  } catch { return null }
}

async function animeScheduleSeasonIndex(year: number, season: string): Promise<Map<string, Media>> {
  const key = seasonIndexKey(year, season)
  let anime = await readCache<RawAnime[]>(key, SEASON_INDEX_TTL)
  if (!anime?.length) {
    const first = await fetchSeasonPage(year, season, 1)
    anime = [...(first?.anime ?? [])]
    const pages = Math.min(6, Math.max(1, Math.ceil((first?.totalAmount ?? anime.length) / 18)))
    // The endpoint is intentionally paced; it rejects a rapid catalogue burst even though each
    // individual page is public and small.
    for (let page = 2; page <= pages; page++) {
      await new Promise((resolve) => setTimeout(resolve, 350))
      const next = await fetchSeasonPage(year, season, page)
      if (!next) break
      anime.push(...(next.anime ?? []))
    }
    if (anime.length) await writeCache(key, anime)
  }
  const out = new Map<string, Media>()
  for (const raw of anime ?? []) {
    const media = mapAnimeScheduleMedia(raw)
    if (raw.route && media) out.set(raw.route.toLowerCase(), media)
  }
  return out
}

/** Weekly raw-broadcast fallback used only when AniList's airing schedule is unavailable. */
export async function getWeeklySchedule(start: number, end: number): Promise<Airing[]> {
  const { year, week } = isoWeek(start)
  const response = await phttp(`https://animeschedule.net/?year=${year}&week=${week}`, {
    timeoutMs: 20_000, maxBytes: 12 * 1024 * 1024, background: true,
  })
  if (!response.ok) throw new Error(`AnimeSchedule timetable returned HTTP ${response.status}`)
  const cards = parseTimetable(await response.text(), start, end)
  if (!cards.length) throw new Error('AnimeSchedule returned no weekly airings')
  const midpoint = new Date((start + 3 * 86400) * 1000)
  const season = ['winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall'][midpoint.getMonth()]
  const exact = await animeScheduleSeasonIndex(midpoint.getFullYear(), season)
  let media = new Map<string, Media>()
  try { media = await fetchKitsuScheduleIndex(midpoint.getFullYear(), season, exact.size < 54) }
  catch (error) { if (!exact.size) throw error }
  const airings = cards.flatMap((card) => {
    const item = exact.get(card.route.toLowerCase())
      ?? media.get(card.route.toLowerCase()) ?? media.get(titleKey(card.title))
    return item ? [{ airingAt: card.airingAt, episode: card.episode, media: item }] : []
  })
  if (!airings.length) throw new Error('AnimeSchedule could not map weekly titles to AniList')
  return airings.sort((a, b) => a.airingAt - b.airingAt)
}

/** Recreate the slot which AniList moves directly to its new date after a postponement. The caller
 * supplies a CURRENT list record, so the title/poster remain available even though the episode is
 * absent from this week's global airing feed. */
export function delayPlaceholder(media: Media, info: ScheduleInfo | null, start: number, end: number): Airing | null {
  const from = info?.delay?.from
  const next = media.nextAiringEpisode
  if (from == null || !next?.episode) return null
  const airingAt = Math.floor(from / 1000)
  if (airingAt < start || airingAt >= end) return null
  return { airingAt, episode: next.episode, media, delayPlaceholder: true }
}

/** Add delay placeholders without duplicating an episode that the primary feed still carries. */
export function mergeScheduleAirings(base: Airing[], delayed: Airing[]): Airing[] {
  const seen = new Set(base.map((airing) => `${airing.media.id}:${airing.episode}`))
  return [...base, ...delayed.filter((airing) => !seen.has(`${airing.media.id}:${airing.episode}`))]
    .sort((a, b) => a.airingAt - b.airingAt)
}

/** Loose title key for the fallback match — the two databases disagree on case, punctuation and
 *  spacing far more often than on the letters ("Fate/Zero" vs "Fate Zero"). */
export const titleKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Search titles in the order AnimeSchedule indexes them (its `title` field is the romaji one).
 *  Structural on purpose so this module stays free of AniList types. */
export const scheduleTitles = (t: { romaji?: string; english?: string }): (string | undefined)[] =>
  [t.romaji, t.english]

/** Pick the entry for an AniList id out of a search page.
 *
 *  Search results carry `websites.aniList`, so the normal case is an EXACT id match and not a fuzzy
 *  one — worth insisting on, because a query like "one piece" comes back with a dozen films and
 *  specials whose titles all match about as well as the series does. Title matching is only the
 *  fallback for entries where AnimeSchedule has not filled the AniList link in; an entry that names
 *  a DIFFERENT id is a positive mismatch rather than a missing link, so it never wins on title. */
export function pickEntry(
  entries: RawAnime[],
  anilistId: number,
  titles: (string | undefined)[],
): RawAnime | null {
  const byId = entries.find((e) => e.route && anilistIdOf(e) === anilistId)
  if (byId) return byId
  const wanted = new Set(titles.filter((t): t is string => !!t?.trim()).map(titleKey))
  if (!wanted.size) return null
  return entries.find((e) => e.route
    && anilistIdOf(e) == null
    && [e.title, e.names?.romaji, e.names?.english].some((t) => t && wanted.has(titleKey(t)))) ?? null
}

// ── Fetch + cache ────────────────────────────────────────────────────────────

const ROUTE_KEY = (id: number) => `animeschedule-route-${id}`
const INFO_KEY = (route: string) => `animeschedule-anime-${route}`
const ROUTE_TTL_MS = 30 * 864e5 // a route is a permalink; re-resolving it is nearly always wasted
const INFO_TTL_MS = 6 * 3600e3  // delays move on a weekly broadcast cycle

interface Stamped<T> { at: number; value: T }

async function readCache<T>(key: string, ttlMs: number): Promise<T | undefined> {
  const hit = await get<Stamped<T>>(key).catch(() => undefined)
  if (!hit) return undefined
  if (Date.now() - hit.at < ttlMs) return hit.value
  // Drop it rather than leaving it to be re-read and re-rejected forever. Unlike the seadex and
  // AniZip caches, an expired value here is never used as an offline fallback — this reader already
  // discards it — so nothing is lost, and the store stops accumulating entries for titles the
  // viewer looked at once a season ago.
  void del(key).catch(() => {})
  return undefined
}

const writeCache = <T>(key: string, value: T) =>
  set(key, { at: Date.now(), value }).catch(() => {})

// Ids AnimeSchedule genuinely has no entry for, remembered for the session so one unmatched title
// doesn't re-run a search on every visit to its page. Written ONLY when the search itself
// succeeded and simply came back without a match — a failed request must never land here, or a
// moment offline (or a single 403) would pin the whole overlay off until restart. Leaving the id
// out lets the next call retry.
const unmatched = new Set<number>()

// The search is paginated — 18 entries a page — and a franchise query overflows that constantly
// ("one piece" answers totalAmount 90, "naruto" 277). Relevance ordering usually puts the series
// on page 1, but the films, specials and sequels sharing its name push it off often enough to
// matter, and a miss is remembered for the whole session, so page 1 alone would pin those titles
// off until restart. Two pages is where it stops: this is an unauthenticated public API that
// answers a burst with "too many requests", and the entry is not on page 3 of a relevance sort.
const SEARCH_PAGES = 2

interface SearchPage { totalAmount?: number; anime?: RawAnime[] }

/** One page of `?q=`, or null when the request itself never answered — the caller must be able to
 *  tell "AnimeSchedule says no" from "we couldn't ask", since only the former is remembered. */
async function searchAnime(query: string, page: number): Promise<SearchPage | null> {
  const url = `${API}?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`
  try {
    const r = await phttp(url, { timeoutMs: TIMEOUT_MS })
    if (!r.ok) return null // rate limit or outage — retryable, so nothing is concluded
    return ((await r.json()) as SearchPage | null) ?? {}
  }
  catch { return null }
}

/** AnimeSchedule route for an AniList id, or null when it can't be resolved. */
export async function resolveRoute(anilistId: number, titles: (string | undefined)[]): Promise<string | null> {
  if (unmatched.has(anilistId)) return null
  const memo = await readCache<string>(ROUTE_KEY(anilistId), ROUTE_TTL_MS)
  if (memo) return memo
  // Romaji and english are the same string on a great many titles; searching it twice would just
  // fetch the same page again.
  const queries = [...new Set(titles.filter((t): t is string => !!t?.trim()))]
  if (!queries.length) return null

  for (const query of queries) {
    let seen = 0
    for (let page = 1; page <= SEARCH_PAGES; page++) {
      const body = await searchAnime(query, page)
      if (!body) return null
      const entries = body.anime ?? []
      const hit = pickEntry(entries, anilistId, titles)
      if (hit?.route) {
        await writeCache(ROUTE_KEY(anilistId), hit.route)
        // A search entry IS the detail payload — same key set, same values, verified field by field
        // against `/anime/{route}` — so keeping it here means fetchAnime's cache read serves it and
        // the detail GET only happens once this TTL lapses on an already-known route. That halves
        // a cold schedule page: 24 requests instead of 48.
        await writeCache(INFO_KEY(hit.route), hit)
        return hit.route
      }
      seen += entries.length
      if (!entries.length || seen >= (body.totalAmount ?? 0)) break
    }
  }
  // Only now, with every title the caller offered searched and answered: the id is genuinely not
  // in there. Concluding this after the first title would write off a show whose romaji missed and
  // whose english would have matched.
  unmatched.add(anilistId)
  return null
}

async function fetchAnime(route: string): Promise<RawAnime | null> {
  const memo = await readCache<RawAnime>(INFO_KEY(route), INFO_TTL_MS)
  if (memo) return memo
  try {
    const r = await phttp(`${API}/${encodeURIComponent(route)}`, { timeoutMs: TIMEOUT_MS })
    if (!r.ok) return null
    const raw = (await r.json()) as RawAnime | undefined
    // Only memoize a body that actually parsed into an entry. Caching a 200 with an unexpected
    // payload would blank the overlay for the whole TTL instead of retrying on the next visit.
    if (!raw?.route) return null
    await writeCache(INFO_KEY(route), raw)
    return raw
  }
  catch { return null }
}

// Coalesce concurrent callers per id. The detail page mounts the badge while the schedule page's
// batch may already be resolving the same title, and neither can see the other through the idb
// cache until the first one has finished writing it.
const inflight = new Map<number, Promise<ScheduleInfo | null>>()

// Resolved payloads, in memory for the session. Coalescing only covers callers that overlap in
// time; idb is what the ones that don't were falling back on, and that is two round-trips per
// title. The schedule grid re-runs its whole batch whenever the viewer's local history changes —
// up to 24 titles, ~48 idb reads — for answers that cannot have moved since. Bounded like the
// discussion cache so a long browse can't grow it without limit.
//
// Holds the RAW payload rather than the finished overlay: whether a window is in effect is
// relative to `now`, so it is recomputed on every read instead of frozen at fetch time.
const MEMO_MAX = 128
const infoMemo = new Map<number, { at: number; raw: RawAnime }>()

function remember(anilistId: number, raw: RawAnime): void {
  infoMemo.set(anilistId, { at: Date.now(), raw })
  // Map iteration is insertion-ordered, so the first key is the oldest entry.
  while (infoMemo.size > MEMO_MAX) {
    const oldest = infoMemo.keys().next()
    if (oldest.done) break
    infoMemo.delete(oldest.value)
  }
}

/** Airing/delay overlay for an AniList title, or null when AnimeSchedule doesn't know it or is
 *  unreachable. Never throws. */
export function getScheduleInfo(anilistId: number, titles: (string | undefined)[]): Promise<ScheduleInfo | null> {
  const hit = infoMemo.get(anilistId)
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return Promise.resolve(normalize(hit.raw))
  const running = inflight.get(anilistId)
  if (running) return running
  const pending = load(anilistId, titles).finally(() => inflight.delete(anilistId))
  inflight.set(anilistId, pending)
  return pending
}

async function load(anilistId: number, titles: (string | undefined)[]): Promise<ScheduleInfo | null> {
  const route = await resolveRoute(anilistId, titles)
  if (!route) return null
  const raw = await fetchAnime(route)
  // Nothing is memoized on a miss: a null is as often "the network is down" as "not carried", and
  // the ids AnimeSchedule genuinely lacks are already remembered by `unmatched`.
  if (!raw) return null
  remember(anilistId, raw)
  return normalize(raw)
}

/** Resolve a bounded batch, keyed by AniList id; misses are simply absent from the map.
 *
 *  The cap and the small concurrency window exist because a week of the schedule can list well over
 *  a hundred titles, and this is a public unauthenticated API — a page open should cost it a
 *  handful of requests, not a hundred simultaneous ones. */
export async function getScheduleInfoMany(
  items: { id: number; titles: (string | undefined)[] }[],
  { limit = 24, concurrency = 4 }: { limit?: number; concurrency?: number } = {},
): Promise<Map<number, ScheduleInfo>> {
  const out = new Map<number, ScheduleInfo>()
  const queue = items.slice(0, limit)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (next < queue.length) {
      const item = queue[next++]
      const info = await getScheduleInfo(item.id, item.titles)
      if (info) out.set(item.id, info)
    }
  }))
  return out
}
