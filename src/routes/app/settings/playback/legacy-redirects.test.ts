import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { legacySettingsRedirect } from '$lib/settings/legacy-routes'
import { load as playerLoad } from '../player/+page'
import { load as hotkeysLoad } from '../hotkeys/+page'

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

describe('legacy Player and Hotkeys routes', () => {
  it('have no page of their own any more', () => {
    expect(existsSync(here('../player/+page.svelte'))).toBe(false)
    expect(existsSync(here('../hotkeys/+page.svelte'))).toBe(false)
  })

  it.each([
    ['/app/settings/player', playerLoad],
    ['/app/settings/player?setting=seek-duration', playerLoad],
    ['/app/settings/hotkeys', hotkeysLoad],
  ] as const)('%s redirects into Playback through legacySettingsRedirect', (href, load) => {
    const target = redirectOf(load, href)
    expect(target.status).toBe(307)
    expect(target.location).toBe(legacySettingsRedirect(new URL(href, BASE)))
    expect(target.location.startsWith('/app/settings/playback')).toBe(true)
  })

  it('sends Hotkeys to the Controls subcategory and keeps a searched row', () => {
    expect(redirectOf(hotkeysLoad, '/app/settings/hotkeys').location).toContain('#controls')
    expect(redirectOf(playerLoad, '/app/settings/player?setting=seek-duration').location).toContain('setting=seek-duration')
  })
})
