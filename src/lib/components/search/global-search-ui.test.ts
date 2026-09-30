import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./GlobalSearch.svelte', import.meta.url)), 'utf8')
// The live search itself is shared with the theme top bar's field.
const quick = readFileSync(fileURLToPath(new URL('../../search/quick-search.ts', import.meta.url)), 'utf8')
const topField = readFileSync(fileURLToPath(new URL('../shell/TopSearchField.svelte', import.meta.url)), 'utf8')

describe('global search focus styling', () => {
  it('suppresses the generic full-input focus outline while retaining the field-row focus state', () => {
    expect(source).toContain('class="global-search-input')
    expect(source).toContain('.global-search-input:focus-visible')
    expect(source).toContain('outline: none;')
    expect(source).toContain('focus-within:border-theme/70')
  })

  it('uses the selected catalog adapter and provider-owned detail route', () => {
    expect(quick).toContain('loadCatalogProvider(selection)')
    expect(source).toContain('await goto(mediaHref(media))')
    expect(source).not.toContain('await goto(`/app/anime/${media.id}`)')
  })

  it('queries all enabled catalogs and merges namespaced results', () => {
    expect(quick).toContain('const catalogs = searched(selections)')
    expect(quick).toContain('Promise.allSettled(catalogs.map(')
    expect(quick).toContain('const key = mediaKey(item)')
    expect(quick).toContain("selection !== 'anilist' || !selections.includes('auto')")
    expect(source).toContain('await quickSearch(clean, activeSelections, {')
    expect(topField).toContain('await quickSearch(text, selections, {')
  })

  it('shows each catalog as it answers and abandons the search the next keystroke replaces', () => {
    expect(quick).toContain('onUpdate?.(ranked())')
    expect(source).toContain('onUpdate: (partial) =>')
    expect(topField).toContain('onUpdate: (media) =>')
    for (const surface of [source, topField]) {
      expect(surface).toContain('const abort = new AbortController()')
      expect(surface).toContain('signal: abort.signal')
      expect(surface).toContain('abort.abort()')
    }
  })
})
