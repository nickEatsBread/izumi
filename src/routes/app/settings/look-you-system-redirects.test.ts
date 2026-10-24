import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'
import { load as accountsLoad } from './accounts/+page'
import { load as profilesLoad } from './profiles/+page'

const BASE = 'https://izumi.invalid'
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/** The redirect a route's load throws for `href`. */
function redirectOf(load: (event: never) => unknown, href: string): { status: number; location: string } {
  try {
    load({ url: new URL(href, BASE) } as never)
  } catch (thrown) {
    return thrown as { status: number; location: string }
  }
  throw new Error(`${href} did not redirect`)
}

/** Old route, its load, and where it lands (contract §1). Later tasks add rows. */
const LEGACY: Array<[string, (event: never) => unknown, string]> = [
  ['profiles', profilesLoad, '/app/settings/accounts#profiles'],
]

describe('Look, You and System legacy routes', () => {
  it.each(LEGACY)('%s has no page of its own', (route) => {
    expect(existsSync(here(`./${route}/+page.svelte`))).toBe(false)
  })

  it.each(LEGACY)('%s redirects through legacySettingsRedirect', (route, load, target) => {
    const href = `/app/settings/${route}`
    const thrown = redirectOf(load, href)
    expect(thrown.status).toBe(307)
    expect(thrown.location).toBe(legacySettingsRedirect(new URL(href, BASE)))
    expect(thrown.location).toBe(target)
  })

  it('sends old Accounts sections to Trackers and leaves current Accounts URLs alone', () => {
    expect(redirectOf(accountsLoad, '/app/settings/accounts?section=connections').location).toBe('/app/settings/accounts#trackers')
    expect(() => accountsLoad({ url: new URL('/app/settings/accounts?manage=profiles', BASE) } as never)).not.toThrow()
    expect(() => accountsLoad({ url: new URL('/app/settings/accounts', BASE) } as never)).not.toThrow()
  })
})
