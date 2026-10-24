import { describe, expect, it } from 'vitest'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'
import { load as catalogHome } from './catalog/home/+page'
import { load as catalogCollections } from './catalog/collections/+page'

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
    ['/app/settings/catalog/home', catalogHome, '/app/settings/library/home', ''],
    ['/app/settings/catalog/collections', catalogCollections, '/app/settings/library/collections', ''],
  ] as Array<[string, Load, string, string]>)('%s redirects through legacySettingsRedirect', (href, load, path, hash) => {
    const target = redirectOf(load, href)
    expect(target?.status).toBe(307)
    expect(target?.location).toBe(legacySettingsRedirect(new URL(href, BASE)))
    const landed = new URL(target!.location, BASE)
    expect(landed.pathname).toBe(path)
    expect(landed.hash).toBe(hash)
  })
})
