// Close matches for a query AniList's own search cannot answer. AniList matches whole words spelled
// exactly, so it finds nothing for a typo ("freiren"), for a title typed with its words glued or
// split ("oshinoko", "tora dora") or for a word still being typed ("frier"). Kitsu's text search
// forgives typos and half-typed words, and its hits carry AniList ids; when it has nothing close
// either, one AniList request tries the query's likely respellings. Title matching
// (title-match.ts) keeps only the hits that actually resemble what was typed.
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { queryAniList } from '$lib/anilist/abortable-query'
import { searchIdsQuery, searchProbeQuery, searchVariables, type SearchFilters } from '$lib/anilist/detail-queries'
import { shouldUseJikanCatalog } from '$lib/anilist/degraded'
import { searchKitsuTitles } from '$lib/anilist/kitsu-catalog'
import { showAdult } from '$lib/settings/ui'
import { normalizeSearchQuery, rankQuickSearchResults } from './global-search'
import { foldTitle, mediaMatch, normalizeTitle, RELEVANT_MATCH } from './title-match'

const CACHE_MS = 2 * 60 * 1000
const CACHE_LIMIT = 50
const cache = new Map<string, { expires: number; media: Media[] }>()
// Respellings repeat while a glued word is typed out ("madeinab", "madeinaby" both try "made").
const respellings = new Map<string, { expires: number; media: Media[] }>()

function remember(store: Map<string, { expires: number; media: Media[] }>, key: string, media: Media[]) {
  store.delete(key)
  store.set(key, { expires: Date.now() + CACHE_MS, media })
  if (store.size > CACHE_LIMIT) store.delete(store.keys().next().value as string)
}

/** Forget remembered answers (tests). */
export function clearCloseMatchCache(): void {
  cache.clear()
  respellings.clear()
}

/** Respellings worth one AniList request: the words as titles abbreviate them ("kaiju no 8"), the
 *  words written together ("toradora") and the start of words typed together ("oshi" for
 *  "oshinoko", the first word of several). */
export function probeQueries(query: string): string[] {
  const words = normalizeTitle(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const probes = new Set<string>()
  const rewritten = words.join(' ')
  if (rewritten !== foldTitle(query)) probes.add(rewritten)
  if (words.length > 1) probes.add(words.join(''))
  const head = words.length > 1 ? words[0] : words[0].length >= 7 ? words[0].slice(0, 4) : ''
  if (head.length >= 4) probes.add(head)
  return [...probes].slice(0, 3)
}

const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
}
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

// Ordered the way live search ranks (own titles first, no obscure namesake), keeping only the hits
// that resemble the query unless `all`.
function byMatch(media: Media[], query: string, all = false): Media[] {
  const resembling = media.filter((item) => {
    const { canonical, alternate } = mediaMatch(item, query)
    return Math.max(canonical, alternate) >= RELEVANT_MATCH
  })
  const ranked = rankQuickSearchResults(resembling, query)
  if (!all) return ranked
  const placed = new Set(ranked)
  return [...ranked, ...media.filter((item) => !placed.has(item))]
}

// Each lookup answers null when it could not be made, so a failure is never remembered as "nothing".
async function kitsuHits(query: string, signal?: AbortSignal): Promise<Media[] | null> {
  try {
    return await searchKitsuTitles(query, signal)
  } catch (error) {
    if (isAbort(error)) throw error
    return null
  }
}

async function respelledHits(query: string, signal?: AbortSignal): Promise<Media[] | null> {
  const probes = probeQueries(query)
  if (!probes.length) return []
  const key = `${get(showAdult)}:${probes.join('|')}`
  const hit = respellings.get(key)
  if (hit && hit.expires > Date.now()) return hit.media
  try {
    const variables = Object.fromEntries(probes.map((probe, index) => [`p${index}`, probe]))
    const result = await queryAniList<Record<string, { media?: Media[] } | null>>(searchProbeQuery(probes.length), variables, signal)
    if (result.error) return null
    const media = probes.flatMap((_, index) => result.data?.[`p${index}`]?.media ?? [])
    remember(respellings, key, media)
    return media
  } catch (error) {
    if (isAbort(error)) throw error
    return null
  }
}

export interface CloseMatchOptions {
  signal?: AbortSignal
  /** Settles once the caller's own AniList search has answered: respellings wait for it. */
  answered?: Promise<unknown>
  /** Whether what the caller has found already holds the title typed, which makes the respelling
   *  request unnecessary (a live-action title another catalog matched, a perfect AniList hit). */
  found?: () => boolean
}

/** Close matches plus whether every lookup behind them could be made: a caller must not remember an
 *  incomplete answer. Never fails the search it supports: an unreachable lookup contributes nothing. */
export async function lookUpCloseMatches(
  query: string,
  options: CloseMatchOptions = {},
): Promise<{ media: Media[]; complete: boolean }> {
  const { signal } = options
  const clean = normalizeSearchQuery(query)
  if (normalizeTitle(clean).replace(/ /g, '').length < 3) return { media: [], complete: true }
  const adult = get(showAdult)
  const visible = (media: Media[]) => (adult ? media : media.filter((item) => !item.isAdult))
  const key = `${adult}:${clean.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return { media: visible(hit.media), complete: true }
  cancelled(signal)
  const kitsu = await kitsuHits(clean, signal)
  let found = byMatch(kitsu ?? [], clean)
  let failed = kitsu == null
  let skipped = false
  cancelled(signal)
  if (!found.length) {
    await options.answered?.catch(() => {})
    cancelled(signal)
    if (options.found?.()) skipped = true
    // An AniList outage answers catalog reads from its backup; these requests would only time out.
    else if (shouldUseJikanCatalog()) failed = true
    else {
      const respelled = await respelledHits(clean, signal)
      failed ||= respelled == null
      found = byMatch(respelled ?? [], clean)
    }
  }
  cancelled(signal)
  const complete = found.length > 0 || !failed
  if (complete && !skipped) remember(cache, key, found)
  return { media: visible(found), complete }
}

/** AniList titles that closely match a query AniList's own search may have missed, best first. */
export async function closeMatches(query: string, options: CloseMatchOptions = {}): Promise<Media[]> {
  return (await lookUpCloseMatches(query, options)).media
}

// Filters a close match found outside AniList's search cannot be checked against without AniList.
const FILTERED: (keyof SearchFilters)[] = [
  'genres', 'season', 'year', 'formats', 'statuses', 'studioId', 'staffId',
  'tagsIn', 'tagsNotIn', 'minTagRank', 'sources', 'country', 'minScore', 'epMin', 'epMax',
]
const filtered = (filters: SearchFilters) => FILTERED.some((key) => {
  const value = filters[key]
  return Array.isArray(value) ? value.length > 0 : value != null && value !== ''
})

/** Close matches for the search page, re-read from AniList under the page's filters so a genre or
 *  year still applies to them, without what `exclude` already shows, and ordered again by AniList's
 *  own titles and popularity (Kitsu names some promo videos exactly like their series). When AniList
 *  cannot re-read them they stand in as they are, but only for an unfiltered search. */
export async function filteredCloseMatches(
  filters: SearchFilters,
  options: { exclude?: ReadonlySet<number>; signal?: AbortSignal; withPreview?: boolean } = {},
): Promise<Media[]> {
  const { exclude, signal, withPreview = true } = options
  const query = filters.search?.trim()
  if (!query) return []
  const matches = (await closeMatches(query, { signal })).filter((item) => !exclude?.has(item.id))
  if (!matches.length) return []
  // During an AniList outage the matches can only stand in as they are.
  if (shouldUseJikanCatalog()) return filtered(filters) ? [] : matches
  const ids = matches.map((item) => item.id)
  // No sort: without a search AniList cannot order by match, and these are re-ordered below anyway.
  const { sort: _sort, ...filterVariables } = searchVariables({ ...filters, search: undefined })
  const variables = { ...filterVariables, ids, page: 1, perPage: ids.length, withPreview }
  let reread: Media[] | undefined
  try {
    const result = await queryAniList<{ Page?: { media?: Media[] } }>(searchIdsQuery(), variables, signal)
    if (!result.error) reread = result.data?.Page?.media
  } catch (error) {
    if (isAbort(error)) throw error
  }
  if (!reread) return filtered(filters) ? [] : matches
  const byId = new Map(reread.map((item) => [item.id, item]))
  return byMatch(ids.flatMap((id) => byId.get(id) ?? []), query, true)
}
