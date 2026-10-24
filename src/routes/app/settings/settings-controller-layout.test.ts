import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const layout = read('./+layout.svelte')
const css = read('../../../app.css')
const sidebar = read('../../../lib/components/shell/Sidebar.svelte')

describe('Settings controller layout (spec §5.1)', () => {
  it('adds a third branch for controller mode between the phone and desktop layouts', () => {
    const phone = layout.indexOf('{#if $isMobile}')
    const controller = layout.indexOf('{:else if $settingsControllerMode}')
    expect(phone).toBeGreaterThan(-1)
    expect(controller).toBeGreaterThan(phone)
    expect(layout.indexOf('{:else}', controller)).toBeGreaterThan(controller)
    expect(layout).toContain("import { settingsControllerMode } from '$lib/settings/surface'")
  })

  it('makes the rail its own d-pad region on TV too, beside a pivoting pane card', () => {
    expect(layout).not.toContain('$isTv ? undefined')
    expect(layout).toContain('<aside data-nav-region="settings" class="flex w-[12.222rem] shrink-0 flex-col">')
    expect(layout).toContain('<div data-settings-search class="mb-2 px-1"><SettingsSearch /></div>')
    expect(layout).toContain('data-settings-pane data-nav-surface="settings" data-nav-scroll-container data-nav-scroll-pivot="0.42"')
    expect(layout).toContain('rounded-[1.556rem] border border-border bg-card/40 p-[1.111rem]')
    expect(layout).toContain('class="flex h-screen gap-[0.889rem] overflow-hidden py-[1.5rem] pl-[1.333rem] pr-[2.667rem]"')
  })

  it('installs the focus zones and lands every navigation through them', () => {
    expect(layout).toContain('return installControllerZones(root)')
    expect(layout).toContain('void controllerLanded(')
  })

  it('shows edge chevrons, and in Game mode the hint bar unless the theme already does', () => {
    expect(layout).toContain('paneEdges = scrollEdges(pane)')
    expect(layout).toContain('{#if $gameMode && !$themePresentation?.shell?.hints}<ButtonHints />{/if}')
  })
})

describe('controller CSS (spec §5.1)', () => {
  it('narrows the TV app strip to 72 px', () => {
    expect(css).toContain('.tv-mode main { margin-left: 4rem !important; margin-bottom: 0 !important; }')
    expect(css).toContain('.tv-mode [data-nav-sidebar] { width: 4rem !important; }')
  })

  it('drops the desktop chips and sticky bar, fills focused rows and lights one rail item at a time', () => {
    expect(css).toContain('[data-settings-controller] [data-settings-chips],')
    expect(css).toContain('[data-settings-controller] [data-settings-sticky] { display: none !important; }')
    expect(css).toContain('[data-settings-controller] [data-settings-rail]:focus-within a[aria-current="page"]:not(:focus) { background-color: transparent; }')
    expect(css).toContain('html[data-theme-hints] [data-settings-controller] { height: calc(100vh - 2.5rem); }')
  })
})

describe('the app sidebar in controller Settings', () => {
  it('lands Left from the settings rail on the Settings destination', () => {
    expect(sidebar).toContain("data-nav-region-default={active('/app/settings') && $settingsControllerMode ? '' : undefined}")
  })

  it('leaves L1/R1 to a page that steps its own sections', () => {
    expect(sidebar).toContain('if (get(pageBumpers)) return')
  })
})
