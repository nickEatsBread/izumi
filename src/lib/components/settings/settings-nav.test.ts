import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { attr, hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

const src = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/+layout.svelte', import.meta.url)), 'utf8')
const dpad = readFileSync(fileURLToPath(new URL('../../nav/index.ts', import.meta.url)), 'utf8')

describe('SettingsNav', () => {
  it('imports the Captions icon from lucide', () => {
    expect(src).toContain("import Captions from '@lucide/svelte/icons/captions'")
  })

  it('has a Subtitles nav entry pointing at the subtitles route', () => {
    expect(src).toContain("{ title: 'Subtitles', href: '/app/settings/subtitles', icon: Captions")
  })

  it('groups Subtitles under Playback, ahead of the Content entries', () => {
    const player = src.indexOf("href: '/app/settings/player'")
    const subs = src.indexOf("href: '/app/settings/subtitles'")
    const sources = src.indexOf("href: '/app/settings/sources'")
    const dl = src.indexOf("href: '/app/settings/downloads'")
    expect(player).toBeGreaterThan(-1)
    expect(subs).toBeGreaterThan(player)
    expect(sources).toBeGreaterThan(subs)
    expect(dl).toBeGreaterThan(sources)
  })

  it('presents addons and community providers as one Sources destination', () => {
    expect(src.match(/title: 'Sources'/g)).toHaveLength(1)
    expect(src).not.toContain("title: 'Extensions'")
    expect(src).not.toContain("href: '/app/settings/extensions'")
  })

  it('keeps the Source Store inside Sources instead of as a separate navigation item', () => {
    expect(src).not.toContain("{ title: 'Source Store', href: '/app/settings/store'")
  })

  it('drops the Hotkeys category on Android, keyed on $isAndroid rather than $isMobile', () => {
    // A narrow desktop window is $isMobile but still has a keyboard, so the filter must not use it.
    expect(src).toContain("import { isAndroid, isMobile } from '$lib/platform'")
    expect(src).toContain("$isAndroid")
    expect(src).toContain("it.href !== '/app/settings/hotkeys'")
    expect(src).toContain('{#each visibleGroups as g (g.label)}')
  })

  it('scrolls the desktop category rail independently through the off-screen About item', () => {
    expect(layout).toContain('<div class="min-h-0 flex-1"><SettingsNav /></div>')
    expect(src).toContain('data-nav-scroll-container')
    expect(src).toContain('overflow-y-auto overscroll-contain')
    expect(dpad).toContain("closest<HTMLElement>('[data-nav-scroll-container]')")
    expect(dpad).toContain("const behavior: ScrollBehavior = rapid || reduced ? 'auto' : 'smooth'")
    expect(dpad).toContain('const target: RevealScrollTarget = pane ?? window')
    expect(dpad).toContain('target.scrollBy({ top: vertical ? top : 0, left: vertical ? 0 : left, behavior })')
  })

  // The engine side (regionOf, the region default, data-nav-scroll-x) is exercised in
  // src/lib/nav/regions.test.ts; this only checks the markers the engine reads.
  it('makes the desktop rail its own nav region, entered on the current category (off TV)', () => {
    const shell = markupElementsFromSource(layout.replace(/\r\n/g, '\n'), '+layout.svelte')
    const regions = shell.filter((el) => hasAttr(el, 'data-nav-region'))
    expect(regions.map((el) => el.name)).toEqual(['aside'])
    expect(attr(regions[0], 'data-nav-region')?.raw).toBe(`data-nav-region={$isTv ? undefined : 'settings'}`)
    expect(shell.filter((el) => staticAttr(el, 'data-nav-surface') === 'settings')).toHaveLength(2)
    const links = markupElementsFromSource(src.replace(/\r\n/g, '\n'), 'SettingsNav.svelte')
      .filter((el) => el.name === 'a' && hasAttr(el, 'data-nav-region-default'))
    expect(links).toHaveLength(1)
    expect(attr(links[0], 'data-nav-region-default')?.raw).toBe(`data-nav-region-default={active(it.href) ? '' : undefined}`)
    expect(attr(links[0], 'aria-current')?.raw).toBe(`aria-current={active(it.href) ? 'page' : undefined}`)
  })
})

describe('Settings Back wiring (commit 10)', () => {
  const nav = src.replace(/\r\n/g, '\n')
  const shell = layout.replace(/\r\n/g, '\n')

  it('lights the rail item from the shared route table', () => {
    expect(nav).toContain("import { settingsRailHref } from '$lib/settings/hierarchy'")
    expect(nav).toContain('const active = (href: string) => settingsRailHref($page.url.pathname) === href')
    expect(nav).not.toContain("href === '/app/settings/sources' && $page.url.pathname === '/app/settings/store'")
  })

  it('keeps controller focus on the rail across a category change, but lets a pointer click go', () => {
    expect(nav).toContain('<nav data-settings-rail data-nav-scroll-container')
    expect(nav).toContain('data-sveltekit-keepfocus onclick={releasePointerFocus}')
    expect(nav).toContain('if (event.detail > 0) (event.currentTarget as HTMLElement).blur()')
    // The desktop rail only: the phone list keeps its own navigation and haptics.
    expect(nav.split('data-sveltekit-keepfocus').length - 1).toBe(1)
  })

  it('titles the phone header and points its back arrow at the structural parent, through settingsBack', () => {
    expect(shell).toContain("import { settingsPageTitle, settingsParent } from '$lib/settings/hierarchy'")
    expect(shell).toContain("import { settingsBack } from '$lib/settings/back'")
    expect(shell).toContain('const childTitle = $derived(settingsPageTitle($page.url.pathname) ?? m.nav_settings())')
    expect(shell).toContain("const parentHref = $derived(settingsParent($page.url.pathname)?.href ?? '/app/settings')")
    expect(shell).toContain("<a href={parentHref} data-focusable onclick={(event) => { event.preventDefault(); h.tap(); settingsBack('header') }} aria-label={m.common_back_to_settings()}")
    expect(shell).not.toContain('const childTitles')
    expect(shell).not.toContain('backHref')
  })
})
