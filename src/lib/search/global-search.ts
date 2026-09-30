import { writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { canonicalTitles, mediaMatch, normalizeTitle, popularityBoost, RELEVANT_MATCH, STRONG_MATCH } from './title-match'

export const globalSearchOpen = writable(false)

export const RECENT_SEARCHES_KEY = 'global-search-recent-v1'
export const MAX_RECENT_SEARCHES = 6

export function openGlobalSearch() {
  globalSearchOpen.set(true)
}

export function closeGlobalSearch() {
  globalSearchOpen.set(false)
}

export function normalizeSearchQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ')
}

export function addRecentSearch(recent: string[], query: string, limit = MAX_RECENT_SEARCHES) {
  const clean = normalizeSearchQuery(query)
  if (!clean) return recent.slice(0, limit)
  const key = clean.toLocaleLowerCase()
  return [clean, ...recent.filter((item) => normalizeSearchQuery(item).toLocaleLowerCase() !== key)].slice(0, limit)
}

export function advancedSearchHref(query: string) {
  const clean = normalizeSearchQuery(query)
  return clean ? `/app/search?search=${encodeURIComponent(clean)}` : '/app/search'
}

/** Convert AniList's occasionally HTML-ish synopsis into compact display text. */
export function plainTextSynopsis(value?: string) {
  return (value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:p|div|li|ul|ol)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

const compactTitle = (title: string) => normalizeTitle(title).replace(/ /g, '')

/**
 * Rank a live result set against what was typed, with typo and spacing tolerance (title-match.ts).
 * Once anything resembles the query, what does not is dropped: some catalogs answer a query they
 * cannot match with their front page, which used to fill the results with unrelated shows.
 *
 * A record's own titles outrank its alternate names. AniList lists "Demon Slayer" among the obscure
 * OVA Onigiri's synonyms, so a record matched only through a synonym is dropped beside an own-title
 * match that is ten times as popular; a series known by an abbreviation ("TenSura") still stands
 * beside a less popular spin-off whose own title starts with it.
 */
export function rankQuickSearchResults(media: Media[], rawQuery: string): Media[] {
  const query = normalizeSearchQuery(rawQuery)
  // One or two letters match too much of every title to rank on: keep the catalogs' own order.
  if (normalizeTitle(query).replace(/ /g, '').length < 3) return media

  const scored = media.map((item, index) => ({ item, index, ...mediaMatch(item, query) }))
  const relevant = (entry: { canonical: number; alternate: number }) => Math.max(entry.canonical, entry.alternate) >= RELEVANT_MATCH

  // A catalog row titled only in another language ("Shingeki no Kyojin" while searching "attack on
  // titan") is the same title as a record that matches, so it sits just below that record.
  const matched = new Map<string, number>()
  for (const entry of scored) {
    if (!relevant(entry)) continue
    const score = Math.max(entry.canonical, entry.alternate)
    for (const title of [...canonicalTitles(entry.item), ...(entry.item.synonyms ?? [])]) {
      const key = title && compactTitle(title)
      if (key && (matched.get(key) ?? 0) < score) matched.set(key, score)
    }
  }
  for (const entry of scored) {
    if (relevant(entry)) continue
    for (const title of canonicalTitles(entry.item)) {
      const score = title ? matched.get(compactTitle(title)) : undefined
      if (score != null) entry.canonical = Math.max(entry.canonical, score - 0.01)
    }
  }

  const own = scored.filter(({ canonical }) => canonical >= RELEVANT_MATCH)
  const floor = 0.1 * Math.max(0, ...own.map(({ item }) => item.popularity ?? 0))
  const kept = scored.filter((entry) => entry.canonical >= RELEVANT_MATCH
    || (entry.alternate >= RELEVANT_MATCH && (entry.item.popularity ?? 0) >= floor))
  // Nothing resembles the query, so nothing tells a match on a title these records do not carry (a
  // translation, a source that only lists romaji) from a source's front page: every answer stays,
  // in its catalog's order. With AniList searched, close matches rarely leave this case open.
  if (!kept.length) return media

  return kept
    .map((entry) => ({
      ...entry,
      rank: (entry.canonical >= RELEVANT_MATCH ? entry.canonical : entry.alternate * 0.95) + popularityBoost(entry.item),
    }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ item }) => item)
}

/** Whether a result set holds a record that is plainly the title typed: when it does not, search
 *  also looks for close matches (close-matches.ts). */
export function hasStrongMatch(media: Media[], rawQuery: string): boolean {
  const query = normalizeSearchQuery(rawQuery)
  return media.some((item) => {
    const { canonical, alternate } = mediaMatch(item, query)
    return Math.max(canonical, alternate) >= STRONG_MATCH
  })
}

/** Guards asynchronous results when a newer query supersedes the request. */
export function createSearchRequestGuard() {
  let generation = 0
  return {
    begin: () => ++generation,
    isCurrent: (request: number) => request === generation,
    invalidate: () => { generation += 1 },
  }
}
