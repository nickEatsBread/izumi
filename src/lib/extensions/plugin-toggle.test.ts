import { describe, it, expect } from 'vitest'
import type { ExtensionConfig } from './types'

// One source URL expands to MANY plugins — a marketplace index yields ~18 — so the per-URL toggle
// is all-or-nothing. These pin the per-plugin selection rules the manager and the settings page
// share: an opt-out list keyed by extension id.

const cfg = (id: string, name = id): ExtensionConfig => ({ id, name, code: `https://x/${id}.js`, type: 'onlinestream-provider' })

/** Mirrors loadConfigs' filter. */
const enabledPlugins = (all: ExtensionConfig[], off: string[]) => all.filter((c) => !off.includes(c.id))

/** Mirrors the settings page's bulk toggle. */
function setAll(off: string[], ids: string[], on: boolean): string[] {
  return on ? off.filter((x) => !ids.includes(x)) : [...new Set([...off, ...ids])]
}

describe('per-plugin enable/disable', () => {
  const all = [cfg('animepahe'), cfg('aniworld'), cfg('animesama')]

  it('keeps everything when nothing is switched off', () => {
    // Opt-out, not opt-in: an existing setup must keep working after the feature lands, and a
    // newly published plugin should appear rather than stay invisible until noticed.
    expect(enabledPlugins(all, []).map((c) => c.id)).toEqual(['animepahe', 'aniworld', 'animesama'])
  })

  it('drops only the switched-off plugin, leaving its siblings alone', () => {
    expect(enabledPlugins(all, ['aniworld']).map((c) => c.id)).toEqual(['animepahe', 'animesama'])
  })

  it('can switch off every plugin in a source without removing the source', () => {
    expect(enabledPlugins(all, ['animepahe', 'aniworld', 'animesama'])).toEqual([])
  })

  it('ignores ids that are not installed', () => {
    expect(enabledPlugins(all, ['gone']).map((c) => c.id)).toEqual(['animepahe', 'aniworld', 'animesama'])
  })
})

describe('bulk toggle', () => {
  const ids = ['a', 'b', 'c']

  it('"All off" adds every id exactly once', () => {
    expect(setAll(['a'], ids, false).sort()).toEqual(['a', 'b', 'c'])
  })

  it('"All on" clears this source without touching another source\'s ids', () => {
    expect(setAll(['a', 'b', 'other'], ids, true)).toEqual(['other'])
  })
})

describe('rebuild key', () => {
  // The bug this guards: the key was the URL list alone, so toggling a plugin left the previous
  // worker set live and the change appeared to do nothing.
  const key = (urls: string[], off: string[]) => JSON.stringify([urls, off])

  it('changes when a plugin is toggled, with the URL list unchanged', () => {
    const urls = ['https://x/repo.json']
    expect(key(urls, [])).not.toBe(key(urls, ['aniworld']))
  })

  it('is stable when nothing changed', () => {
    expect(key(['u'], ['a'])).toBe(key(['u'], ['a']))
  })
})
