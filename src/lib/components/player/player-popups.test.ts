import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The desktop player's popups: above the seek bar, out of the way of a GIF recording, a way back to the
// series from the Episodes panel, and the API 9 `player.menu` hook (row size, close on select).
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const controls = read('./Controls.svelte')
const menu = read('./PlayerContextMenu.svelte')
const panel = read('./PlayerEpisodes.svelte')
const seekbar = read('./Seekbar.svelte')

describe('player popups', () => {
  it('stack above the seek bar, whose skip segments (z-10) and knob (z-20) share their stacking context', () => {
    expect(seekbar).toMatch(/absolute top-1\/2 z-10 h-0\.5[^"]*\{segClass\[s\.type\]/)
    expect(controls).toContain('data-options-menu data-part="player.menu" data-variant="options" class="absolute bottom-full right-0 z-30 ')
    expect(controls).toContain('data-part="player.menu" data-variant="tracks" class="absolute bottom-full right-0 z-30 ')
    expect(menu).toMatch(/data-part="player\.menu" data-variant="context"[^>]*class="pointer-events-auto absolute z-30 /)
  })

  it('close when a GIF recording starts or stops from them', () => {
    const gif = controls.slice(controls.indexOf('async function toggleGifRecording()'))
    expect(gif.indexOf('closePlayerMenus()')).toBeGreaterThan(-1)
    expect(gif.indexOf('closePlayerMenus()')).toBeLessThan(gif.indexOf('await playerGifStart('))
  })

  it("make the Episodes panel's series title leave the player for the series page", () => {
    expect(panel).toContain('<a href={mediaHref(media)} use:detailLink={media} data-focusable')
    expect(panel).toContain('onclick={(event) => { event.preventDefault(); onclose(); onseries(media) }}')
    expect(controls).toContain('<PlayerEpisodes onclose={() => (showEpisodes = false)} onseries={openSeries} />')
    // Back's own exit first (fullscreen, PiP, timers, the GIF recorder), then the series page.
    expect(controls).toMatch(/async function openSeries\(media: Media\) \{\s+await onclose\(\)\s+await openSeriesPage\(media\)\s+\}/)
    expect(controls).toContain("import { openDetail as openSeriesPage } from '$lib/anilist/detail-hint'")
  })
})

describe('player popup hook (API 9 player.menu)', () => {
  it('marks every option and page heading, and the chosen option', () => {
    for (const source of [controls, menu]) {
      expect(source).toContain('data-part="player.menu.item"')
      expect(source).toContain('data-part="player.menu.back"')
    }
    for (const chosen of [
      "data-state={speed === s ? 'active' : undefined}",
      "data-state={qualityInfo.mode === height ? 'active' : undefined}",
      "data-state={$videoFit === fit.id ? 'active' : undefined}",
      "data-state={detailOff ? 'active' : undefined}",
      "data-state={(detailCat === 'secondary' ? String(t.id) === secondaryId : t.selected) ? 'active' : undefined}",
      "data-state={i === activeChapter ? 'active' : undefined}",
    ]) expect(controls).toContain(chosen)
    expect(menu).toContain("data-state={choice.checked ? 'active' : undefined}")
  })

  it("sizes the options from the theme's custom properties, izumi's own 36 and 12 px by default", () => {
    const css = read('../../../app.css')
    expect(css).toContain('html { --theme-player-menu-row-height: 36px; --theme-player-menu-row-padding: 12px; }')
    expect(css).toMatch(/\[data-part="player\.menu\.item"\] \{\s+min-height: var\(--theme-player-menu-row-height\);\s+padding-left: var\(--theme-player-menu-row-padding\);\s+padding-right: var\(--theme-player-menu-row-padding\);/)
    const theme = read('../../theme.ts')
    expect(theme).toContain("root.style.setProperty('--theme-player-menu-row-height', `${menu.rowHeight}px`)")
    expect(theme).toContain("root.style.setProperty('--theme-player-menu-row-padding', `${menu.rowPadding}px`)")
    expect(theme).toContain("else root.style.removeProperty('--theme-player-menu-row-height')")
  })

  it('closes a popup on a chosen option only when the theme asks, in Game mode too', () => {
    expect(controls).toContain('const closeOnSelect = $derived($themePresentation?.player?.menu?.closeOnSelect === true)')
    expect(controls).toMatch(/function chosen\(\) \{\s+if \(!closeOnSelect\) return\s+closePlayerMenus\(\)\s+bumpPlayerOverlay\(\)\s+\}/)
    for (const pick of [
      "onclick={() => { setSpeed(s); optionsPage = 'root'; chosen() }}",
      "onclick={() => { void setVideoQuality(height); optionsPage = 'root'; chosen() }}",
      "onclick={() => { setFit(fit.id); optionsPage = 'root'; chosen() }}",
      'onclick={() => { pickOff(); chosen() }}',
      'onclick={() => { pick(leafKind, t.id); chosen() }}',
      'onclick={() => { pickSessionSubtitleStyle(p); chosen() }}',
      "setSleep((event.currentTarget as HTMLSelectElement).value); chosen() }}",
      // Game mode's settings sheet: touch and pad.
      'onclick={() => { setSpeed(s); chosen() }}',
      'onclick={() => { setFit(fit.id); chosen() }}',
      "} else if (gmSettingsPage === 'speed') { setSpeed(speeds[i] ?? 1); chosen() }",
    ]) expect(controls).toContain(pick)
    expect(controls).toMatch(/function gmPickTrack[\s\S]*?gmOpenPage\('root'\)\s+chosen\(\)\s+\}/)
    // Steppers and tools are not choices: they never call it.
    expect(controls).not.toMatch(/adjust\(prop, [^)]*\);\s*chosen\(\)/)
    expect(controls).not.toContain('markLoopA(); chosen()')
  })
})
