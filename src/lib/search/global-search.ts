import { writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'

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

function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function canonicalTitles(media: Media) {
  return [
    media.title.english,
    media.title.romaji,
    media.title.native,
    media.title.userPreferred,
  ].filter((value): value is string => !!value)
}

function titleRelevance(title: string, query: string) {
  const value = normalizeTitle(title)
  if (!value || !query) return 0

  // Prefer the shortest title that expresses the requested phrase. This makes a main series such
  // as "Demon Slayer: Kimetsu no Yaiba" beat a movie whose longer title has the same prefix.
  const closeness = Math.round((query.length / Math.max(query.length, value.length)) * 100)
  if (value === query) return 4_000
  if (value.startsWith(`${query} `)) return 3_000 + closeness
  if (` ${value} `.includes(` ${query} `)) return 2_500 + closeness

  const queryTokens = [...new Set(query.split(' ').filter(Boolean))]
  const valueTokens = new Set(value.split(' '))
  const matched = queryTokens.filter((token) => valueTokens.has(token)).length
  if (matched === queryTokens.length) return 2_000 + closeness
  if (matched > 0) return 1_000 + Math.round((matched / queryTokens.length) * 100)
  return 0
}

/**
 * AniList's SEARCH_MATCH order is fuzzy and can occasionally put an unrelated title first.
 * Re-rank the small Quick Search result set by every known title/synonym. When at least one
 * textual match exists, omit zero-match strays; when none exists (usually a typo), retain the
 * API order so AniList's fuzzy matching still works.
 */
export function rankQuickSearchResults(media: Media[], rawQuery: string): Media[] {
  const query = normalizeTitle(normalizeSearchQuery(rawQuery))
  if (!query) return media

  const ranked = media.map((item, index) => {
    const canonical = canonicalTitles(item).reduce(
      (best, candidate) => Math.max(best, titleRelevance(candidate, query)),
      0,
    )
    const synonym = (item.synonyms ?? []).reduce(
      (best, candidate) => Math.max(best, titleRelevance(candidate, query)),
      0,
    )
    return { item, index, canonical, relevance: canonical > 0 ? 10_000 + canonical : synonym }
  })
  // Prefer canonical results as a class, not just by sort order. AniList calls Onigiri
  // "Demon Slayer" in its synonyms; leaving synonym-only rows in this result set made an
  // unrelated show look like a valid Demon Slayer result. Synonyms remain useful when the API
  // supplies no canonical match for an alternate/localized title.
  const hasCanonicalMatch = ranked.some(({ canonical }) => canonical > 0)
  const hasTextualMatch = ranked.some(({ relevance }) => relevance > 0)
  return ranked
    .filter(({ canonical, relevance }) =>
      hasCanonicalMatch ? canonical > 0 : (!hasTextualMatch || relevance > 0))
    .sort((a, b) =>
      b.relevance - a.relevance
      || (b.item.popularity ?? 0) - (a.item.popularity ?? 0)
      || a.index - b.index)
    .map(({ item }) => item)
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
