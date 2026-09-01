import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./CatalogSearchPage.svelte')
const advanced = read('./TmdbAdvancedFilters.svelte')
const stremioAdvanced = read('./StremioAdvancedFilters.svelte')
const provider = read('../../catalog/providers/tmdb.ts')
const stremioProvider = read('../../catalog/providers/stremio.ts')
const jvmFilters = read('./JvmSourceFilters.svelte')

describe('TMDB search filters', () => {
  it('keeps the primary search surface compact and reveals advanced filters on demand', () => {
    expect(page).toContain('More filters{advancedCount ? ` · ${advancedCount}` : \'\'}')
    expect(page).toContain('<TmdbAdvancedFilters')
    expect(page).toContain('showAdvanced && isTmdb')
    expect(page).toContain('[scrollbar-width:none]')
    expect(page).toContain("{ value: 'oldest', label: 'Oldest releases' }")
    expect(page).toContain("{ value: 'title', label: 'Title A–Z' }")
  })

  it('round-trips every advanced value through URL and provider requests', () => {
    for (const [state, param] of [
      ['minScore', 'score'],
      ['maxScore', 'maxScore'],
      ['minVotes', 'votes'],
      ['language', 'language'],
      ['country', 'country'],
      ['releaseDateFrom', 'releaseFrom'],
      ['releaseDateTo', 'releaseTo'],
      ['excludedGenres', 'excludeGenres'],
      ['withPoster', 'withPoster'],
    ]) {
      expect(page).toContain(`params.set('${param}'`)
      expect(page).toContain(`${state},`)
    }
  })

  it('offers rating, confidence, release, genre, language, country, and artwork controls', () => {
    expect(advanced).toContain('Minimum rating')
    expect(advanced).toContain('Maximum rating')
    expect(advanced).toContain('Rating confidence')
    expect(advanced).toContain('Original language')
    expect(advanced).toContain('Country of origin')
    expect(advanced).toContain('Release window')
    expect(advanced).toContain('Excluded genres')
    expect(advanced).toContain('Require a poster')
    expect(advanced).toContain('disabled={datesInvalid}')
  })

  it('loads authoritative language and country options from TMDB', () => {
    expect(provider).toContain("'/configuration/languages'")
    expect(provider).toContain("'/configuration/countries'")
    expect(provider).toContain('searchOptions,')
  })

  it('continues through a bounded number of empty text-search pages', () => {
    expect(page).toContain('emptyPageStreak < 4')
    expect(page).toContain('queueMicrotask(() => void loadMore())')
    expect(page).toContain('Promise.allSettled')
  })

  it('applies Discover filters server-side and poster filtering locally', () => {
    expect(provider).toContain("'vote_average.lte': request.maxScore")
    expect(provider).toContain("'primary_release_date.gte': isoDate(request.releaseDateFrom)")
    expect(provider).toContain("'first_air_date.lte': isoDate(request.releaseDateTo)")
    expect(provider).toContain('without_genres: excludedGenres.length')
    expect(provider).toContain('request.withPoster && !item.poster_path')
  })

  it('shows useful TMDB metadata beneath each result', () => {
    expect(page).toContain('tmdbMetadata(item)')
    expect(page).toContain("`${(item.averageScore / 10).toFixed(1)} ★`")
  })
})

describe('JVM source filters', () => {
  it('searches all enabled sources until the user chooses one', () => {
    expect(page).toContain("{ value: '', label: 'All enabled sources' }")
    expect(page).toContain('bind:value={jvmSourceId}')
    expect(page).toContain('sourceId: isJvm ? jvmSourceId || undefined')
  })

  it('reveals the selected source’s native filter model on demand', () => {
    expect(page).toContain('jvmCatalogSourceFilters(sourceId')
    expect(page).toContain('<JvmSourceFilters')
    for (const type of ['CheckBox', 'TriState', 'Select', 'Sort', 'Text', 'Group']) {
      expect(jvmFilters).toContain(`filter.type === '${type}'`)
    }
  })
})

describe('Stremio search filters', () => {
  it('reveals a provider-specific advanced panel without crowding the quick bar', () => {
    expect(page).toContain('isTmdb || isStremio')
    expect(page).toContain('<StremioAdvancedFilters')
    expect(page).toContain('showAdvanced && isStremio')
  })

  it('round-trips runtime and add-on filters through URL and provider requests', () => {
    for (const [state, param] of [
      ['runtimeMin', 'runtimeMin'],
      ['runtimeMax', 'runtimeMax'],
      ['sourceAddonId', 'addon'],
    ]) {
      expect(page).toContain(`params.set('${param}'`)
      expect(page).toContain(`${state},`)
    }
  })

  it('offers source, rating, runtime, release, metadata, genre, and artwork controls', () => {
    for (const label of [
      'Metadata add-on', 'Rating range', 'Runtime', 'Release window', 'Original language',
      'Country of origin', 'Exclude genres', 'Require poster artwork',
    ]) expect(stremioAdvanced).toContain(label)
  })

  it('loads add-on and genre options and applies metadata filters in the provider', () => {
    expect(stremioProvider).toContain('async function genres()')
    expect(stremioProvider).toContain('async function searchOptions()')
    expect(stremioProvider).toContain('filterAndSortStremioMedia(media, request)')
    expect(stremioProvider).toContain('sourceAddonId')
  })
})
