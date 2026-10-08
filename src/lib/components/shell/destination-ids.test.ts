import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_HOOKS } from '$lib/themes/hooks'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
// The movable destinations (`NavItemId` in settings/nav.ts; that module imports Svelte icons, so it is read, not imported).
const NAV_IDS = [...(/export type NavItemId = ([^\n]+)/.exec(read('../../settings/nav.ts'))?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1])

// `data-dest` names a destination wherever it sits, so a theme draws a destination's own glyph (or a
// centre button) by name instead of by position or link target, which users and routes change.
describe('destination ids', () => {
  it('names every destination link on the bottom bar, the rail, the top bar, the drawer and the panel', () => {
    expect(read('./BottomNav.svelte')).toMatch(/data-part="nav\.item"\s+data-dest=\{item\.id\}/)
    expect(read('./Sidebar.svelte')).toContain('<a data-part="nav.item" data-dest={it.id} ')
    expect(read('./NavDrawer.svelte')).toContain('<a data-part="nav.item" data-dest={item.id} ')
    expect(read('./NavPanel.svelte')).toContain('<a data-part="nav.item" data-dest={item.id} ')
    // The Categories menu button is not a destination.
    expect(read('./CategoriesMenu.svelte')).not.toContain('data-dest')
  })

  it("uses the bottom bar's ids on the rail and in the menus", () => {
    expect(NAV_IDS).toEqual(['schedule', 'downloads', 'watch', 'settings', 'search', 'trakt', 'letterboxd', 'library'])
    const sidebar = read('./Sidebar.svelte')
    const ids = [...sidebar.matchAll(/\{ id: '([a-z]+)', href: '\/app\/([a-z]+)'/g)].map((match) => [match[1], match[2]])
    expect(ids.map(([id]) => id)).toEqual(['home', 'schedule', 'search', 'downloads', 'watch', 'library', 'settings'])
    for (const [id, route] of ids) {
      expect(route).toBe(id)
      if (id !== 'home') expect(NAV_IDS).toContain(id)
    }
  })

  it('names the Home app bar destinations', () => {
    expect(read('../../../routes/app/home/+page.svelte')).toContain('<a data-part="home.header.action" data-dest={c.id} href={meta.href}')
    const shell = THEME_HOOKS.shell ?? []
    expect(shell.find((hook) => hook.name === 'home.header.action')?.states).toEqual(['data-dest'])
    expect(shell.find((hook) => hook.name === 'nav.item')?.states).toContain('data-dest')
    expect(shell.find((hook) => hook.name === 'nav.bottom')?.states).toEqual(['data-state', 'data-count'])
  })

  // A collapsed pill is sized to its destinations; publishing the count spares a stylesheet from
  // counting links structurally (`:has(> a:nth-of-type(n))`).
  it('publishes the number of bottom-bar destinations, Home included', () => {
    const bar = read('./BottomNav.svelte')
    expect(bar).toMatch(/data-slot="nav\.bottom"\s+data-state=\{\$scrollChrome\}\s+data-count=\{items\.length\}/)
    expect(bar).toContain('style:--nav-items={items.length}')
    expect(bar).toContain('{#each items as item (item.id)}')
  })

  it('names the row holding the Home app bar destinations', () => {
    const home = read('../../../routes/app/home/+page.svelte')
    expect(home).toContain('<div data-part="home.header.actions" class="flex items-center gap-1">')
    expect(home.indexOf('data-part="home.header.actions"')).toBeLessThan(home.indexOf('data-part="home.header.action" data-dest'))
    // The header reads its own list, which may repeat a bottom-bar tab (API 4).
    expect(home).toContain('const topNav = $derived($homeHeaderNav)')
  })
})
