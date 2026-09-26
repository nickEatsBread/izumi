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

/** A single-catalog Home uses the role as its row id (dropping a provider prefix); Merged Home needs
 * an exact id or picks the first catalog that offers the bare role. */
export function resolveRowId(target: CatalogHomeTarget, role: string, optionIds: string[]): string | null {
  if (target !== 'merged') return bareRole(role)
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

function providerSection(source: Extract<RowSource, { kind: 'provider' }>, signal?: AbortSignal): Promise<CatalogHomeSection | null> {
  const key = `${source.selection}:${source.rowId}`
  const cached = sectionCache.get(key)
  if (cached && Date.now() - cached.at < SECTION_TTL_MS) return cached.section
  const section = loadCatalogProvider(source.selection)
    .then((provider) => provider.home(signal, [source.rowId]))
    .then((home) => home.sections.find((item) => item.id === source.rowId) ?? null)
  section.catch(() => sectionCache.delete(key))
  sectionCache.set(key, { at: Date.now(), section })
  return section
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
