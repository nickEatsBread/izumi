import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./CatalogSearchPage.svelte')
const advanced = read('./TmdbAdvancedFilters.svelte')
const provider = read('../../catalog/providers/tmdb.ts')
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
      ['minVotes', 'votes'],
      ['language', 'language'],
      ['country', 'country'],
    ]) {
      expect(page).toContain(`params.set('${param}'`)
      expect(page).toContain(`${state},`)
    }
  })

  it('offers rating, confidence, language, and country controls', () => {
    expect(advanced).toContain('Minimum rating')
    expect(advanced).toContain('Rating confidence')
    expect(advanced).toContain('Original language')
    expect(advanced).toContain('Country of origin')
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
