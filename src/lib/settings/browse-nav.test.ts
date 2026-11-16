import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { browseScreen, browseShown, catalogProvider } from './catalog'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('Browse is opt-in', () => {
  afterEach(() => {
    browseScreen.set(false)
    catalogProvider.set('auto')
  })

  it('is off until it is turned on', () => {
    catalogProvider.set('auto')
    expect(get(browseScreen)).toBe(false)
    expect(get(browseShown)).toBe(false)
    browseScreen.set(true)
    expect(get(browseShown)).toBe(true)
  })

  it('is always listed on a source screen, whose pack styles it', () => {
    catalogProvider.set('source:crunchyroll.izumi')
    expect(get(browseShown)).toBe(true)
  })

  it('keeps a new install and an untouched profile off', () => {
    expect(read('./catalog.ts')).toContain("persisted<boolean>('browse-screen-v1', false)")
  })

  it('drops Browse from every placement while it is off', () => {
    const nav = read('./nav.ts')
    expect(nav).toContain("shown ? items : items.filter((item) => item.id !== 'browse')")
    expect(nav).toContain('export const effectiveNav = derived([placedNav, browseShown], ([$nav, $browse]) => withBrowse($nav, $browse))')
    expect(nav).toContain("return withBrowse(ids.map((id) => ({ id: id as NavItemId, placement: 'top' as const })), $browse)")
    // The rail, the top bar and the drawer; Categories and a source's menus only ever follow Browse.
    const sidebar = read('../components/shell/Sidebar.svelte')
    expect(sidebar).toContain("const listed = $derived($browseShown ? items : items.filter((it) => it.id !== 'browse'))")
    expect(sidebar).toContain('searchModeNav(listed)')
    expect(sidebar).toContain("item.id === 'browse' ? [item, categoriesItem, ...menuItems]")
  })

  it('has a switch in Settings, Home and library', () => {
    const page = read('../../routes/app/settings/library/+page.svelte')
    expect(page).toContain('settingKey="browse-screen"')
    expect(page).toContain('onActivate={() => ($browseScreen = !$browseScreen)}')
    expect(read('./search.ts')).toContain("key: 'browse-screen'")
  })
})
