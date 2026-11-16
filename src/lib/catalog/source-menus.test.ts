import { describe, expect, it } from 'vitest'
import type { AddonManifest } from '$lib/stremio/manifest'
import { listingHref, sourceMenus } from './source-menus'

const manifest = (catalogs: unknown[]) => ({ id: 'x', version: '1', name: 'x', resources: [], types: [], catalogs }) as unknown as AddonManifest

describe('the listings a source puts in the menu', () => {
  it('reads each labelled menu listing, its icon and the extra it opens on', () => {
    const menus = sourceMenus(manifest([
      { type: 'series', id: 'list', name: 'List', extra: [{ name: 'skip' }], izumi: { menu: { label: 'Watchlist', icon: 'bookmark' } } },
      { type: 'series', id: 'seasons', name: 'Seasons', extra: [{ name: 'season', options: ['Fall', 'Summer', 'Fall'] }], izumi: { menu: { label: 'Seasons', icon: 'calendar', extra: 'season' } } },
      { type: 'series', id: 'odd', name: 'Odd', izumi: { menu: { label: 'Odd', icon: 'rocket' } } },
      { type: 'series', id: 'plain', name: 'Plain' },
    ]))
    expect(menus.map(({ value, label, icon, extra, options }) => ({ value, label, icon, extra, options }))).toEqual([
      { value: 'series:list', label: 'Watchlist', icon: 'bookmark', extra: undefined, options: [] },
      { value: 'series:seasons', label: 'Seasons', icon: 'calendar', extra: 'season', options: ['Fall', 'Summer'] },
      { value: 'series:odd', label: 'Odd', icon: 'list', extra: undefined, options: [] },
    ])
  })

  it('leaves out a listing that would open on an empty wall or has no label', () => {
    expect(sourceMenus(manifest([
      { type: 'series', id: 'a', name: 'A', izumi: { menu: { label: 'Seasons', extra: 'season' } } },
      { type: 'series', id: 'b', name: 'B', izumi: { menu: { label: '  ' } } },
    ]))).toEqual([])
  })

  it('links to the listing, narrowed to an option of its extra', () => {
    expect(listingHref({ value: 'series:list' })).toBe('/app/listing?catalog=series%3Alist')
    expect(listingHref({ value: 'series:seasons', extra: 'season' }, 'Fall 2026')).toBe('/app/listing?catalog=series%3Aseasons&season=Fall+2026')
  })
})
