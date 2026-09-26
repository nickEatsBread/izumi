// One page of a Home row, for blocks that show a row as a grid or a ranked list. AniList rows page
// with the same filters as their carousel; other catalogs page through the search request behind
// the row's "View more" link, which is the provider's own notion of "the rest of this row".
import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { CARD_MEDIA_FIELDS } from '$lib/anilist/fragments'
import { homeSections } from '$lib/anilist/queries'
import type { Media } from '$lib/anilist/types'
import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
import { decodeMergedCatalogHomeRowId, loadCatalogProvider } from '$lib/catalog/registry'
import type { CatalogHomeRowOption, CatalogHomeSection } from '$lib/catalog/types'
import { gameMode } from '$lib/player/session'
import type { CatalogSelection } from '$lib/settings/catalog'
import { showAdult } from '$lib/settings/ui'

export interface RowPage { media: Media[]; hasNextPage: boolean; lastPage?: number }
type ProviderSelection = Exclude<CatalogSelection, 'auto' | 'anilist'>
export type RowSource = { kind: 'anilist'; role: string } | { kind: 'provider'; selection: ProviderSelection; rowId: string }

const LOCAL_ROLES = new Set(['continue', 'list', 'recommendations', 'recent'])
const EMPTY: RowPage = { media: [], hasNextPage: false }
const bareRole = (id: string) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)

/** "Load more" appends pages; a title repeated across pages would break a keyed list, so keep the first copy. */
export function appendUnique(current: Media[], next: Media[]): Media[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...next.filter((item) => !seen.has(item.id) && seen.add(item.id))]
}

/** Rows a tab can show: catalog rows only. Local, tracker and schedule rows have their own sections. */
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

// Same two-variant adult split as the carousel query (AniList needs the argument omitted to include adult titles).
const ROW_PAGE_QUERY = gql`
  query RowPage($page: Int = 1, $perPage: Int = 18, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`
const ROW_PAGE_QUERY_ALL = gql`
  query RowPageAll($page: Int = 1, $perPage: Int = 18, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $genre: String, $withPreview: Boolean = true) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      media(type: ANIME, sort: $sort, season: $season, seasonYear: $seasonYear, genre: $genre) { ...CardMediaFields }
    }
  }
  ${CARD_MEDIA_FIELDS}`

const SECTION_TTL_MS = 5 * 60_000
const sectionCache = new Map<string, { at: number; section: Promise<CatalogHomeSection | null> }>()
export function clearRowSourceCache(): void { sectionCache.clear() }

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
