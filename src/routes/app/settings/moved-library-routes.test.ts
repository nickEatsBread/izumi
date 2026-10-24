import { describe, expect, it } from 'vitest'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'
import { load as catalog } from './catalog/+page'
import { load as catalogHome } from './catalog/home/+page'
import { load as catalogCollections } from './catalog/collections/+page'
import { load as history } from './history/+page'
import { load as scenes } from './scenes/+page'
import { load as extensions } from './extensions/+page'
import { load as sources } from './sources/+page'
import { load as storage } from './storage/+page'

const BASE = 'https://izumi.invalid'
type Load = (event: { url: URL }) => unknown

/** What `load` throws for `href`: SvelteKit's Redirect carries `status` and `location`. */
function redirectOf(load: Load, href: string): { status: number; location: string } | undefined {
  try {
    load({ url: new URL(href, BASE) })
  } catch (thrown) {
    return thrown as { status: number; location: string }
  }
  return undefined
}

describe('Library routes that moved', () => {
  it.each([
    ['/app/settings/catalog', catalog, '/app/settings/library', '#home'],
    ['/app/settings/catalog/home', catalogHome, '/app/settings/library/home', ''],
    ['/app/settings/catalog/collections', catalogCollections, '/app/settings/library/collections', ''],
    ['/app/settings/history', history, '/app/settings/library', '#history'],
    ['/app/settings/scenes', scenes, '/app/settings/library', '#scenes'],
    ['/app/settings/extensions', extensions, '/app/settings/sources/manage', ''],
    ['/app/settings/sources?tab=manage', sources, '/app/settings/sources/manage', ''],
    ['/app/settings/sources?tab=ordering', sources, '/app/settings/sources', '#priority'],
    ['/app/settings/sources?tab=playback', sources, '/app/settings/playback', '#quality'],
    ['/app/settings/storage', storage, '/app/settings/downloads', '#storage'],
  ] as Array<[string, Load, string, string]>)('%s redirects through legacySettingsRedirect', (href, load, path, hash) => {
    const target = redirectOf(load, href)
    expect(target?.status).toBe(307)
    expect(target?.location).toBe(legacySettingsRedirect(new URL(href, BASE)))
    const landed = new URL(target!.location, BASE)
    expect(landed.pathname).toBe(path)
    expect(landed.hash).toBe(hash)
  })

  it('renders the Sources section itself without a redirect', () => {
    expect(redirectOf(sources, '/app/settings/sources')).toBeUndefined()
    expect(redirectOf(sources, '/app/settings/sources?setting=default-discussion-source')).toBeUndefined()
  })

  it('keeps the searched row when an old link carries ?setting=', () => {
    const target = redirectOf(history, '/app/settings/history?setting=incognito-mode')
    expect(target?.status).toBe(307)
    const landed = new URL(target!.location, BASE)
    expect(landed.pathname).toBe('/app/settings/library')
    expect(landed.searchParams.get('setting')).toBe('incognito-mode')
  })
})
