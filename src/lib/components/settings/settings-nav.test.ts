import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { attr, hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

const src = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/+layout.svelte', import.meta.url)), 'utf8')
const dpad = readFileSync(fileURLToPath(new URL('../../nav/index.ts', import.meta.url)), 'utf8')

describe('SettingsNav', () => {
  it('builds the phone index and the desktop rail from the section registry', () => {
    expect(src).toContain("import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '$lib/settings/sections'")
    expect(src).toContain("import { sectionIcon } from '$lib/components/settings/section-icons'")
    expect(src).not.toMatch(/href: '\/app\/settings\//)
  })

  it('groups the phone index under the group labels, each row with its static subtitle', () => {
    expect(src).toContain('const groups = SETTINGS_GROUPS.map((group) => ({ ...group, items: SETTINGS_SECTIONS.filter((section) => section.group === group.id) }))')
    expect(src).toContain('{#each groups as g (g.id)}')
    expect(src).toContain('text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</div>')
    expect(src).toContain('<span class="mt-0.5 block truncate text-xs text-muted-foreground">{it.subtitle}</span>')
  })

  it('has nothing to filter per platform: Hotkeys and Navigation are no longer categories', () => {
    // The Playback and Appearance pages gate those old pages instead (section-routes.test.ts).
    expect(src).not.toContain('isAndroid')
    expect(src).not.toContain('/app/settings/hotkeys')
    expect(src).not.toContain('/app/settings/navigation')
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
  it('makes the Settings rail its own nav region on every rail layout, TV included', () => {
    const shell = markupElementsFromSource(layout.replace(/\r\n/g, '\n'), '+layout.svelte')
    const regions = shell.filter((el) => hasAttr(el, 'data-nav-region'))
    // The controller layout's aside, then the desktop one.
    expect(regions.map((el) => el.name)).toEqual(['aside', 'aside'])
    expect(regions.map((el) => staticAttr(el, 'data-nav-region'))).toEqual(['settings', 'settings'])
    // The phone child, the controller pane and the desktop content.
    expect(shell.filter((el) => staticAttr(el, 'data-nav-surface') === 'settings')).toHaveLength(3)
    const links = markupElementsFromSource(src.replace(/\r\n/g, '\n'), 'SettingsNav.svelte')
      .filter((el) => el.name === 'a' && hasAttr(el, 'data-nav-region-default'))
    // The controller rail and the desktop rail.
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(attr(link, 'aria-current')?.raw).toMatch(/^aria-current=\{active\(\w+\.href\) \? 'page' : undefined\}$/)
    }
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
    // The desktop and controller rails only: the phone list keeps its own navigation and haptics.
    expect(nav.split('data-sveltekit-keepfocus').length - 1).toBe(2)
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

describe('controller rail (spec §5.1)', () => {
  const nav = src.replace(/\r\n/g, '\n')

  it('renders first in controller mode, with a divider between groups', () => {
    const controller = nav.indexOf('{#if $settingsControllerMode}')
    expect(controller).toBeGreaterThan(-1)
    expect(nav.indexOf('{:else if $isMobile}')).toBeGreaterThan(controller)
    expect(nav).toContain("import { settingsControllerMode } from '$lib/settings/surface'")
    expect(nav).toContain('{#if index > 0 && SETTINGS_SECTIONS[index - 1].group !== section.group}')
    expect(nav).toContain('<div role="separator" class="mx-4 my-1 h-px shrink-0 bg-border"></div>')
  })

  it('keeps the markers the zones, Back and search read, as 48-56 px pills with a pivoting scroll', () => {
    expect(nav).toContain('<nav data-settings-rail data-nav-scroll-container data-nav-scroll-pivot="0.42"')
    const link = markupElementsFromSource(nav, 'SettingsNav.svelte').find((el) => el.name === 'a' && hasAttr(el, 'data-section'))!
    expect(attr(link, 'data-section')?.raw).toBe('data-section={section.id}')
    expect(attr(link, 'data-group')?.raw).toBe('data-group={section.group}')
    expect(hasAttr(link, 'data-sveltekit-keepfocus')).toBe(true)
    expect(attr(link, 'data-nav-region-default')?.raw).toBe(`data-nav-region-default={active(section.href) ? '' : undefined}`)
    expect(nav).toContain('class="flex h-12 shrink-0 items-center gap-3 rounded-full px-4 text-base transition-colors')
  })

  it('prints the short rail label, with the full section title for hover and screen readers', () => {
    const link = markupElementsFromSource(nav, 'SettingsNav.svelte').find((el) => el.name === 'a' && hasAttr(el, 'data-section'))!
    expect(attr(link, 'title')?.raw).toBe('title={section.title}')
    expect(attr(link, 'aria-label')?.raw).toBe('aria-label={section.title}')
    expect(nav).toContain('<span class="truncate">{section.railTitle}</span>')
    expect(nav).not.toContain('{section.title}</span>')
  })
})
