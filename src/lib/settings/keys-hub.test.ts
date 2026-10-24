import { describe, expect, it } from 'vitest'
import { KEY_HUB, keyHubHref } from './keys-hub'
import { SETTINGS_SEARCH_INDEX } from './search'

const BASE = 'https://izumi.invalid'

describe('Keys hub', () => {
  it('lists each stored credential once', () => {
    expect(KEY_HUB.map((entry) => entry.id)).toEqual(['tmdb', 'omdb', 'opensubtitles', 'subdl', 'jimaku', 'debrid'])
  })

  it('links every key to the section that edits it, never back to Accounts', () => {
    const expected: Record<string, string> = {
      tmdb: '/app/settings/library',
      omdb: '/app/settings/library',
      opensubtitles: '/app/settings/subtitles',
      subdl: '/app/settings/subtitles',
      jimaku: '/app/settings/subtitles',
      debrid: '/app/settings/sources',
    }
    for (const entry of KEY_HUB) expect(new URL(keyHubHref(entry), BASE).pathname, entry.id).toBe(expected[entry.id])
  })

  it('reveals the editing row, or opens its subcategory when the index names no row', () => {
    for (const entry of KEY_HUB) {
      const item = SETTINGS_SEARCH_INDEX.find((candidate) => candidate.title === entry.searchTitle)!
      const url = new URL(keyHubHref(entry), BASE)
      if (item.key) expect(url.searchParams.get('setting'), entry.id).toBe(item.key)
      else expect(url.hash, entry.id).toBe(`#${item.subcategory}`)
    }
  })

  it('fails loudly when a search entry is renamed', () => {
    expect(() => keyHubHref({ id: 'tmdb', title: 'x', description: 'x', searchTitle: 'No such entry' })).toThrow('No such entry')
  })

  it('keeps row descriptions to one short line', () => {
    for (const entry of KEY_HUB) expect(entry.description.length, entry.id).toBeLessThanOrEqual(80)
  })
})
