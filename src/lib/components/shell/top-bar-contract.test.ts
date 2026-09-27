import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('theme top bar', () => {
  it('shows text links and a centred brand with the plain izumi text when the theme asks', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("const topBar = $derived($themePresentation?.shell?.top ?? {})")
    expect(bar).toContain("topBar.labels ?? 'icons'")
    expect(bar).toContain("topBar.brand === 'center'")
    expect(bar).toContain('{#if top}<BrandText')
  })

  it('puts a search field in the bar instead of the Search link', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('<TopSearchField')
    expect(bar).toContain("topBar.search === 'field-center'")
    expect(bar).toContain("topBar.search === 'field-end'")
    const field = read('./TopSearchField.svelte')
    expect(field).toContain('data-part="search.field"')
    expect(field).toContain('/app/search?search=')
  })

  it('opens every destination in a drawer from a menu button', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("topBar.menu === 'drawer'")
    expect(bar).toContain('data-part="nav.menu"')
    expect(bar).toContain('<NavDrawer')
    const drawer = read('./NavDrawer.svelte')
    expect(drawer).toContain('data-slot="nav.drawer"')
    expect(drawer).toContain("event.key === 'Escape'")
  })

  it('closes the drawer like the app\'s other modals and returns focus to the menu button', () => {
    const drawer = read('./NavDrawer.svelte')
    expect(drawer).toContain('role="dialog"')
    expect(drawer).toContain('aria-modal="true"')
    expect(drawer).toContain('data-nav-trap data-nav-escape')
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('bind:this={menuBtn}')
    expect(bar).toContain('menuBtn?.focus({ preventScroll: true })')
  })

  it('lays the centred-brand top bar out as three grid columns so the links cannot run under it', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("{brandCentered ? '!grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}")
    expect(bar).toContain('class="flex min-w-0 items-center gap-1 overflow-hidden"')
    expect(bar).toContain('class="flex items-center justify-end gap-1"')
    // The side rail and the non-centred top bar must keep their exact existing layout classes —
    // the grid override is appended, not substituted, so this string must stay byte-for-byte.
    expect(bar).toContain("top ? 'inset-x-0 top-0 h-[4.75rem] w-full flex-row items-center border-b border-border/50 bg-background px-3 pt-8' : 'inset-y-0 left-0 flex-col py-3 pt-9'")
  })

  it('gives TopSearchField a focusable/tabindex passthrough so it is not a Tab stop during playback', () => {
    const field = read('./TopSearchField.svelte')
    expect(field).toContain('focusable = true')
    expect(field).toContain('data-focusable={focusable ? \'\' : undefined} {tabindex}')
    const bar = read('./Sidebar.svelte')
    const fieldCalls = bar.match(/<TopSearchField [^/]*\/>/g) ?? []
    expect(fieldCalls.length).toBe(3)
    for (const call of fieldCalls) {
      expect(call).toContain('focusable={!$playing}')
      expect(call).toContain('tabindex={tab}')
    }
  })
})
