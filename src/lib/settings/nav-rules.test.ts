import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NavItemConfig, NavItemId } from './nav'
import { PHONE_BOTTOM_LIMIT, PINNED_NAV_IDS, allowedPlacements, pinNavItems } from './nav-rules'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const IDS: NavItemId[] = ['schedule', 'downloads', 'watch', 'settings', 'search', 'trakt', 'letterboxd', 'library']

/** A full layout: `bottom` ids on the bar, `top` ids as Home icons, everything else (Settings included) hidden. */
function config(bottom: NavItemId[], top: NavItemId[] = []): NavItemConfig[] {
  return IDS.map((id) => ({ id, placement: bottom.includes(id) ? 'bottom' : top.includes(id) ? 'top' : 'hidden' }))
}
const placementOf = (items: NavItemConfig[], id: NavItemId) => items.find((item) => item.id === id)?.placement
const onBottom = (items: NavItemConfig[]) => items.filter((item) => item.placement === 'bottom').length

describe('navigation placement rules', () => {
  it('pins Settings, and only Settings, to a visible placement', () => {
    expect(PINNED_NAV_IDS).toEqual(['settings'])
    expect(allowedPlacements('settings')).toEqual(['bottom', 'top'])
    for (const id of IDS.filter((id) => id !== 'settings')) expect(allowedPlacements(id)).toEqual(['bottom', 'top', 'hidden'])
  })

  it('hands out a fresh list each time', () => {
    allowedPlacements('schedule').pop()
    expect(allowedPlacements('schedule')).toEqual(['bottom', 'top', 'hidden'])
  })

  it('leaves a layout whose Settings is visible untouched, item for item', () => {
    const input = config(['schedule', 'settings'], ['search'])
    const output = pinNavItems(input, { themed: false, phone: true })
    expect(output).toEqual(input)
    output.forEach((item, index) => expect(item).toBe(input[index]))
  })

  it('puts a hidden Settings on the desktop bottom bar, themed or not', () => {
    const input = config(['schedule', 'downloads', 'watch', 'search', 'library'])
    expect(placementOf(pinNavItems(input, { themed: false, phone: false }), 'settings')).toBe('bottom')
    expect(placementOf(pinNavItems(input, { themed: true, phone: false }), 'settings')).toBe('bottom')
  })

  it('puts a hidden Settings on top of a themed phone layout, so the theme bar keeps its width', () => {
    const full = pinNavItems(config(['schedule', 'downloads', 'watch', 'search', 'library']), { themed: true, phone: true })
    expect(placementOf(full, 'settings')).toBe('top')
    expect(onBottom(full)).toBe(PHONE_BOTTOM_LIMIT)
    const short = pinNavItems(config(['schedule']), { themed: true, phone: true })
    expect(placementOf(short, 'settings')).toBe('top')
    expect(onBottom(short)).toBe(1)
  })

  it("puts a hidden Settings on the bottom bar of the user's own phone layout until it holds five", () => {
    expect(PHONE_BOTTOM_LIMIT).toBe(5)
    expect(placementOf(pinNavItems(config(['schedule', 'downloads']), { themed: false, phone: true }), 'settings')).toBe('bottom')
    const four = pinNavItems(config(['schedule', 'downloads', 'watch', 'search']), { themed: false, phone: true })
    expect(placementOf(four, 'settings')).toBe('bottom')
    expect(onBottom(four)).toBe(5)
    const five = pinNavItems(config(['schedule', 'downloads', 'watch', 'search', 'library']), { themed: false, phone: true })
    expect(placementOf(five, 'settings')).toBe('top')
    expect(onBottom(five)).toBe(5)
  })

  it('never moves, reorders or copies another destination and never mutates its input', () => {
    const input = config(['schedule'], ['search'])
    const before = structuredClone(input)
    const output = pinNavItems(input, { themed: false, phone: true })
    expect(input).toEqual(before)
    expect(output).not.toBe(input)
    expect(output.map((item) => item.id)).toEqual(IDS)
    output.forEach((item, index) => { if (item.id !== 'settings') expect(item).toBe(input[index]) })
    expect(placementOf(output, 'trakt')).toBe('hidden')
  })
})

describe('effective navigation wiring', () => {
  const nav = read('./nav.ts')

  it('re-derives on the phone layout and pins both theme and user layouts', () => {
    expect(nav).toContain("import { isMobile } from '$lib/platform'")
    expect(nav).toContain("import { pinNavItems } from './nav-rules'")
    expect(nav).toContain('export const effectiveNav = derived([navConfig, activeThemeLayout, isMobile], ([$c, layout, $isMobile]) => {')
    expect(nav).toContain('if (themed) return pinNavItems(themed as NavItemConfig[], { themed: true, phone: $isMobile })')
    expect(nav).toContain('return pinNavItems(out, { themed: false, phone: $isMobile })')
  })

  it('keeps nav-rules on type-only imports from nav.ts, so the two never form a runtime cycle', () => {
    const rules = read('./nav-rules.ts')
    expect(rules).toContain("import type { NavItemConfig, NavItemId, NavPlacement } from './nav'")
    expect(rules).not.toMatch(/^import \{[^}]*\} from '\.\/nav'$/m)
  })
})

describe('Navigation settings page', () => {
  const page = read('../../routes/app/settings/navigation/+page.svelte')

  it('offers Settings only the placements it may take and guards every write', () => {
    expect(page).toContain("import { allowedPlacements } from '$lib/settings/nav-rules'")
    expect(page).toContain('{#each placements.filter((p) => allowedPlacements(it.id).includes(p.value)) as p (p.value)}')
    const guard = page.indexOf('if (!allowedPlacements(id).includes(p)) return')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(page.indexOf('navConfig.set($effectiveNav.map((it) => (it.id === id ? { ...it, placement: p } : it)))'))
  })

  it('says why Settings has no Hidden option', () => {
    expect(page).toContain("Settings can't be hidden, so you can always get back here.")
  })
})
