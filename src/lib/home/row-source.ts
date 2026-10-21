// One page of a Home row, for blocks that show a row as a grid or a ranked list. AniList rows page
// with the same filters as their carousel; other catalogs page through the search request behind
// the row's "View more" link, which is the provider's own notion of "the rest of this row".
import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { airedBefore } from '$lib/anime/airing-week'
import { CARD_MEDIA_FIELDS } from '$lib/anilist/fragments'
import { homeSections, RECENT_RELEASES_QUERY } from '$lib/anilist/queries'
import type { Media } from '$lib/anilist/types'
import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
import { decodeMergedCatalogHomeRowId, loadCatalogProvider } from '$lib/catalog/registry'
import type { CatalogHomeRowOption, CatalogHomeSection } from '$lib/catalog/types'
import { gameMode } from '$lib/player/session'
import type { CatalogSelection } from '$lib/settings/catalog'
import { dismissedRecentReleaseIds, showAdult } from '$lib/settings/ui'

/** One page of a row. `episodes` (the recently aired row only) is the latest aired episode of each
 *  title on the page, by media id. */
export interface RowPage { media: Media[]; hasNextPage: boolean; lastPage?: number; episodes?: Record<number, number> }
type ProviderSelection = Exclude<CatalogSelection, 'auto' | 'anilist'>
export type RowSource = { kind: 'anilist'; role: string } | { kind: 'provider'; selection: ProviderSelection; rowId: string }

// Rows backed by this device or a tracker account. The recently aired row (`recent`) is not one: it
// pages the airing schedule like a catalog row, one entry per show.
const LOCAL_ROLES = new Set(['continue', 'list', 'recommendations'])
const EMPTY: RowPage = { media: [], hasNextPage: false }
const bareRole = (id: string) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)

/** "Load more" appends pages; a title repeated across pages would break a keyed list, so keep the first copy. */
export function appendUnique(current: Media[], next: Media[]): Media[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...next.filter((item) => !seen.has(item.id) && seen.add(item.id))]
}

/** A catalog row a theme slot can show: not a block, the banner, or a local or tracker row. */
export const isContentRow = (id: string): boolean => id !== 'hero' && !id.startsWith('block:') && !LOCAL_ROLES.has(bareRole(id))

/** Rows a tab can show: catalog rows and the recently aired schedule. Local and tracker rows have
 * their own sections. */
export function tabbableRows(options: CatalogHomeRowOption[]): CatalogHomeRowOption[] {
  return options.filter((option) => !option.id.startsWith('block:') && !LOCAL_ROLES.has(bareRole(option.id)))
}

/** A single-catalog Home uses the role as its row id verbatim, UNLESS it is a merged-style
 * `provider:row` id (e.g. a tab kept from when the block lived on Merged Home) — then the provider
 * prefix is dropped. A real single-catalog row id can itself contain colons (the Stremio catalog's
 * `<origin>:<catalog>`, the JVM catalog's `popular:<source>`), so those must survive unchanged.
 * Merged Home needs an exact id or picks the first catalog that offers the bare role. */
export function resolveRowId(target: CatalogHomeTarget, role: string, optionIds: string[]): string | null {
  if (target !== 'merged') {
    const decoded = decodeMergedCatalogHomeRowId(role)
    return decoded ? decoded.rowId : role
  }
  if (optionIds.includes(role)) return role
  if (role.includes(':')) return null
  return optionIds.find((id) => id.endsWith(`:${role}`)) ?? null
}

// What another catalog calls the rows a theme names by AniList role, read from the words of a row's
// id (`top`, `imdbRating`, `latest:<source>`, `now-playing` …).
const ROLE_WORDS: Record<string, string[]> = {
  trending: ['trending', 'trend', 'hot'],
  popular: ['popular', 'popularity', 'top', 'top10', 'most'],
  rated: ['rated', 'rating', 'score', 'best', 'featured', 'acclaimed'],
  newest: ['newest', 'new', 'latest', 'recent', 'year', 'now'],
  recent: ['recent', 'latest', 'new', 'newest', 'today'],
  season: ['season', 'seasonal', 'airing', 'ongoing', 'current', 'air'],
  upcoming: ['upcoming', 'next', 'soon', 'anticipated'],
  movies: ['movie', 'movies', 'film', 'films'],
  romance: ['romance'],
  action: ['action'],
  fantasy: ['fantasy'],
}
const idWords = (id: string) => new Set(id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/))

/** Theme layouts name AniList's rows by role; another catalog's rows have ids of their own. Each role
 *  takes, in turn, the row with its id, a row whose id says the same thing (the one naming the
 *  fewest of these roles, then the earliest), then the catalog's next row no other role took — so a
 *  theme's every slot shows this catalog's rows. On AniList, and for local roles (Continue, Your List),
 *  a role only matches exactly. */
export function resolveRoles(target: CatalogHomeTarget, roles: string[], optionIds: string[], shown?: string[]): Map<string, string> {
  const resolved = new Map<string, string>()
  const used = new Set<string>()
  const take = (role: string, id: string) => { resolved.set(role, id); used.add(id) }
  const unique = [...new Set(roles)]
  // Theme layouts are drawn against AniList's rows: there a role means exactly that row.
  const native = target === 'auto' || target === 'anilist'
  for (const role of unique) {
    const id = resolveRowId(target, role, optionIds)
    if (id && (native || optionIds.includes(id))) take(role, id)
  }
  if (native) return resolved
  const open = unique.filter((role) => !resolved.has(role) && role !== 'hero' && !LOCAL_ROLES.has(bareRole(role)))
  // Word and next-row matches come from the rows this Home loads (`shown`), when it says which.
  const pool = optionIds.filter((id) => isContentRow(id) && (!shown || shown.includes(id)))
  const named = new Map(pool.map((id) => {
    const words = idWords(id)
    return [id, open.filter((role) => ROLE_WORDS[role]?.some((word) => words.has(word)))]
  }))
  for (const role of open) {
    const match = pool.filter((id) => !used.has(id) && named.get(id)!.includes(role))
      .sort((a, b) => named.get(a)!.length - named.get(b)!.length)[0]
    if (match) take(role, match)
  }
  for (const role of open) {
    const next = resolved.has(role) ? undefined : pool.find((id) => !used.has(id))
    if (next) take(role, next)
  }
  return resolved
}

export function rowSource(target: CatalogHomeTarget, rowId: string): RowSource | null {
  if (target === 'merged') {
    const decoded = decodeMergedCatalogHomeRowId(rowId)
    if (!decoded) return null
    return decoded.selection === 'auto' || decoded.selection === 'anilist'
      ? { kind: 'anilist', role: decoded.rowId }
      : { kind: 'provider', selection: decoded.selection, rowId: decoded.rowId }
  }
  return target === 'auto' || target === 'anilist' ? { kind: 'anilist', role: rowId } : { kind: 'provider', selection: target, rowId }
}

// Same two-variant adult split as the carousel query (AniList needs the argument omitted to include
// adult titles). `$format`/`$status` are likewise optional with no default, so an omitted preset
// value stays omitted rather than becoming a `null` filter — see the fuller note in queries.ts.
const ROW_PAGE_QUERY = gql`
  query RowPage($page: Int = 1, $perPage: Int = 18, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $format: MediaFormat, $status: MediaStatus, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre, format: $format, status: $status) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`
const ROW_PAGE_QUERY_ALL = gql`
  query RowPageAll($page: Int = 1, $perPage: Int = 18, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $format: MediaFormat, $status: MediaStatus, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      media(type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre, format: $format, status: $status) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`

const SECTION_TTL_MS = 5 * 60_000
const sectionCache = new Map<string, { at: number; section: Promise<CatalogHomeSection | null> }>()
export function clearRowSourceCache(): void { sectionCache.clear(); recentList = null }

// The recently aired row (`recent`) as pages: the airing schedule newest first over the same window
// the Recently Released row reads (RecentReleaseRow), one entry per show at its latest episode. The
// schedule pages by episode, so the shows are gathered across schedule pages and kept for a while;
// a later page continues the same list instead of starting again.
const RECENT_WINDOW_DAYS = 21
const RECENT_SCHEDULE_PAGE = 50
/** At most this many schedule pages (episodes) are read into one list. */
const RECENT_MAX_SCHEDULE_PAGES = 10
/** Calendar weeks the backup schedule reads to cover the window (it starts mid-week). */
const RECENT_BACKUP_WEEKS = 4
type RecentRelease = { episode: number; airingAt: number; media: Media | null }
interface RecentList {
  at: number
  adult: boolean
  after: number
  before: number
  shows: { media: Media; episode: number }[]
  seen: Set<number>
  schedulePage: number
  more: boolean
  pending?: Promise<void>
}
let recentList: RecentList | null = null

async function readRecentSchedule(list: RecentList): Promise<void> {
  const result = await anilist.query(RECENT_RELEASES_QUERY, {
    page: list.schedulePage + 1, perPage: RECENT_SCHEDULE_PAGE, after: list.after, before: list.before, withPreview: !get(gameMode),
  }).toPromise()
  let releases = (result.data?.Page as { airingSchedules?: RecentRelease[] } | undefined)?.airingSchedules ?? []
  if (result.error) {
    // While AniList is out the backup schedule lists the whole window at once.
    if (list.schedulePage > 0) throw result.error
    releases = (await airedBefore(anilist, list.before, Infinity, RECENT_BACKUP_WEEKS).catch(() => { throw result.error }))
      .filter((release) => release.airingAt > list.after)
  }
  list.schedulePage += 1
  list.more = !result.error && releases.length >= RECENT_SCHEDULE_PAGE
  for (const release of releases) {
    // AniList's airing schedule has no adult filter of its own, as on the Recently Released row.
    if (!release.media || list.seen.has(release.media.id) || (!list.adult && release.media.isAdult)) continue
    list.seen.add(release.media.id)
    list.shows.push({ media: release.media, episode: release.episode })
  }
}

/** One page of recently aired titles, newest first, without the ones the viewer dismissed from the
 *  Recently Released row. */
async function loadRecentPage(page: number, perPage: number): Promise<RowPage> {
  const adult = get(showAdult)
  if (!recentList || Date.now() - recentList.at > SECTION_TTL_MS || recentList.adult !== adult) {
    const before = Math.floor(Date.now() / 1000) + 60
    recentList = { at: Date.now(), adult, before, after: before - RECENT_WINDOW_DAYS * 86_400, shows: [], seen: new Set(), schedulePage: 0, more: true }
  }
  const list = recentList
  const dismissed = new Set(get(dismissedRecentReleaseIds))
  const visible = () => list.shows.filter((show) => !dismissed.has(show.media.id))
  // One title past the page tells whether there is a next one.
  while (visible().length <= page * perPage && list.more && list.schedulePage < RECENT_MAX_SCHEDULE_PAGES) {
    list.pending ??= readRecentSchedule(list).finally(() => { list.pending = undefined })
    await list.pending
  }
  const shows = visible()
  const slice = shows.slice((page - 1) * perPage, page * perPage)
  return {
    media: slice.map((show) => show.media),
    hasNextPage: shows.length > page * perPage,
    episodes: Object.fromEntries(slice.map((show) => [show.media.id, show.episode])),
  }
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError')
}

/** Race a shared (cache-owned) load against one caller's own signal, without the caller ever being
 * able to abort the load itself — another caller may still be waiting on the same entry. */
function settleOnAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(abortError()) }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}

/** Fetch one provider section, owned by the cache rather than any single caller. Its own
 * AbortController is never aborted by a caller, so one caller giving up cannot fail another
 * caller sharing this entry, and cannot cut the fetch off from under them either. */
function loadProviderSection(source: Extract<RowSource, { kind: 'provider' }>, key: string): Promise<CatalogHomeSection | null> {
  const owned = new AbortController()
  const section = loadCatalogProvider(source.selection)
    .then((provider) => provider.home(owned.signal, [source.rowId]))
    .then((home) => home.sections.find((item) => item.id === source.rowId) ?? null)
  // Never let a not-found/failed load sit in the cache for the full TTL — a provider that swallows
  // its own abort/error could otherwise freeze an empty row in place for up to 5 minutes. Only clear
  // the entry if it still points at THIS load (a fresher load may have already replaced it).
  const forget = () => { if (sectionCache.get(key)?.section === section) sectionCache.delete(key) }
  section.then((result) => { if (result == null) forget() }, forget)
  return section
}

function providerSection(source: Extract<RowSource, { kind: 'provider' }>, signal?: AbortSignal): Promise<CatalogHomeSection | null> {
  const key = `${source.selection}:${source.rowId}`
  const cached = sectionCache.get(key)
  const fresh = cached && Date.now() - cached.at < SECTION_TTL_MS
  const section = fresh ? cached.section : loadProviderSection(source, key)
  if (!fresh) sectionCache.set(key, { at: Date.now(), section })
  return settleOnAbort(section, signal)
}

export async function loadRowPage(target: CatalogHomeTarget, rowId: string, page: number, perPage: number, signal?: AbortSignal): Promise<RowPage> {
  const source = rowSource(target, rowId)
  if (!source) return EMPTY
  if (source.kind === 'anilist') {
    if (source.role === 'recent') return settleOnAbort(loadRecentPage(page, perPage), signal)
    const section = homeSections(new Date()).find((item) => item.key === source.role)
    if (!section) return EMPTY
    const result = await anilist.query(get(showAdult) ? ROW_PAGE_QUERY_ALL : ROW_PAGE_QUERY, {
      ...section.vars, page, perPage, withPreview: !get(gameMode),
    }).toPromise()
    if (result.error) throw result.error
    const data = result.data?.Page as { pageInfo?: { hasNextPage?: boolean; lastPage?: number | null }; media?: Media[] } | undefined
    return { media: data?.media ?? [], hasNextPage: !!data?.pageInfo?.hasNextPage, ...(data?.pageInfo?.lastPage ? { lastPage: data.pageInfo.lastPage } : {}) }
  }
  const section = await providerSection(source, signal)
  if (!section || section.presentation === 'providers') return EMPTY
  if (!section.more) return page === 1 ? { media: section.media.slice(0, perPage), hasNextPage: false } : EMPTY
  const provider = await loadCatalogProvider(source.selection)
  const result = await provider.search({ ...section.more, page, signal })
  return { media: result.media, hasNextPage: result.hasNextPage }
}
