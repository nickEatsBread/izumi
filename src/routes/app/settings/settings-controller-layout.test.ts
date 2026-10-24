import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const layout = read('./+layout.svelte')
const css = read('../../../app.css')
const sidebar = read('../../../lib/components/shell/Sidebar.svelte')
const hintBar = read('../../../lib/components/shell/ButtonHints.svelte')
const controllerBranch = layout.slice(layout.indexOf('{:else if $settingsControllerMode}'), layout.lastIndexOf('{:else}'))

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
    // Its height comes from app.css (the space main leaves), not h-screen.
    expect(layout).toContain('class="flex gap-[0.889rem] overflow-hidden py-[1.5rem] pl-[1.333rem] pr-[2.667rem]"')
  })

  it('names the page for assistive tech, as the other layouts do', () => {
    expect(controllerBranch).toContain('<h1 class="sr-only">{m.nav_settings()}</h1>')
  })

  it('cross-fades a section switch in the pane, inside the observed content wrapper', () => {
    expect(controllerBranch).toContain('<div bind:this={controllerContent}>\n          {#key railSection}\n            <div in:fly={sectionFade()}>{@render children()}</div>\n          {/key}\n        </div>')
  })

  it('installs the focus zones and lands every navigation through them', () => {
    expect(layout).toContain('return installControllerZones(root)')
    expect(layout).toContain('void controllerLanded(')
  })

  it('starts a new page at the pane top, leaving history steps and reveals alone', () => {
    const reset = "if (controllerPane && navigation.type !== 'popstate' && to && !to.hash && !to.searchParams.has(SETTING_PARAM)) controllerPane.scrollTop = 0"
    expect(layout).toContain(reset)
    expect(layout.indexOf(reset)).toBeLessThan(layout.indexOf('void controllerLanded('))
  })

  it('shows edge chevrons, and in Game mode the hint bar unless the theme already does', () => {
    expect(layout).toContain('const next = scrollEdges(pane)')
    // Only a flip re-renders the chevrons; held d-pad scrolls fire this every frame.
    expect(layout).toContain('if (next.up !== paneEdges.up || next.down !== paneEdges.down) paneEdges = next')
    expect(layout).toContain('untrack(update)')
    expect(layout).toContain('{#if $gameMode && !$themePresentation?.shell?.hints}<ButtonHints />{/if}')
  })
})

describe('controller CSS (spec §5.1)', () => {
  it('narrows the TV app strip to 72 px', () => {
    // The rail only: a theme's TV top bar keeps its width and the page under it no margin.
    expect(css).toContain(".tv-mode:not([data-theme-nav='top']) main { margin-left: 4rem !important; }")
    expect(css).toContain(".tv-mode [data-slot='nav.side'] { width: 4rem !important; }")
  })

  it('drops the desktop chips and sticky bar, fills focused rows and lights one rail item at a time', () => {
    expect(css).toContain('[data-settings-controller] [data-settings-chips],')
    expect(css).toContain('[data-settings-controller] [data-settings-sticky] { display: none !important; }')
    expect(css).toContain('[data-settings-controller] [data-settings-rail]:focus-within a[aria-current="page"]:not(:focus) { background-color: transparent; }')
  })

  it('fits the layout to the height main leaves under every Game-mode bar and the hint bar', () => {
    expect(css).toContain('height: calc(100vh - var(--settings-top) - var(--settings-bar) - var(--settings-hints));')
    expect(css).toContain("html.gamemode[data-theme-nav='top'] [data-settings-controller] { --settings-top: var(--theme-top-row); }")
    expect(css).toContain("html.gamemode[data-theme-nav='bottom'] [data-settings-controller] { --settings-bar: var(--theme-bottom-nav, 4rem); }")
    expect(css).toContain('html[data-theme-hints] [data-settings-controller] { --settings-hints: 2.5rem; }')
    // TV forces the side strip whatever the theme's nav, so only Game mode subtracts a bar.
    expect(css).not.toMatch(/html\[data-theme-nav='(?:top|bottom)'\] \[data-settings-controller\]/)
  })
})

describe('the app sidebar in controller Settings', () => {
  it('lands Left from the settings rail on the Settings destination', () => {
    // Not in a top bar, where the link sits at the far right.
    expect(sidebar).toContain("data-nav-region-default={active('/app/settings') && $settingsControllerMode && !top ? '' : undefined}")
  })

  it('leaves L1/R1 to a page that steps its own sections', () => {
    expect(sidebar).toContain('if (get(pageBumpers)) return')
  })

  it('keeps the hint bar room while either bar is shown, and starts a late bar shown under a pad', () => {
    expect(hintBar).toContain('<script module lang="ts">')
    expect(hintBar).toContain("return () => { if (--shownBars === 0) root.removeAttribute('data-theme-hints') }")
    expect(hintBar).toContain("let padActive = $state(get(inputType) === 'dpad')")
  })
})
