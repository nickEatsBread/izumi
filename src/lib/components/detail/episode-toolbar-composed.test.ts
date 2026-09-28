import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))
const read = (file: string) => readFileSync(path(file), 'utf8')
const list = read('./EpisodeList.svelte')
const detail = read('./AnimeDetail.svelte')

describe('themed episode toolbar', () => {
  it('composes the toolbar from the tested plan', () => {
    expect(list).toContain("import { planEpisodeToolbar } from './toolbar-plan'")
    expect(list).toContain('{#if plan.composed}')
    expect(list).toContain('<EpisodeToolbar {plan}')
    expect(list).toContain("const dir = $derived<SortDir>(episodeTheme?.order === 'none' ? 'asc' : sortDir)")
    expect(list).toContain('const rows = $derived(searchedEpisodes ? eps : orderEpisodes(eps, dir))')
    // The gutter decision moved into the tested plan (`plan.gutter`, toolbar-plan.ts).
    expect(list).toContain('{#if plan.gutter && aired > 0}')
    expect(list).toContain('{#if !selecting && !offline && !plan.composed}')
    expect(list).toContain('{#if selecting || !plan.composed}')
    expect(list).toContain("const pagerShown = $derived(episodeTheme?.paging !== 'ranges' && !(episodeTheme?.paging === 'dropdown' && aired > 0))")
  })
  it('draws each control with its hook and keeps the rest in the overflow menu', () => {
    expect(existsSync(path('./EpisodeToolbar.svelte'))).toBe(true)
    const bar = read('./EpisodeToolbar.svelte')
    for (const hook of ['episodes.heading', 'episodes.count', 'episodes.more', 'episodes.range', 'episodes.sort', 'episodes.layout', 'episodes.search', 'episodes.download', 'episodes.queue']) {
      expect(bar, hook).toContain(`data-part="${hook}"`)
    }
    expect(bar).toContain('data-slot="episodes.toolbar" data-variant={plan.variant}')
    expect(bar.match(/data-part="episodes\.menu"/g)?.length).toBe(3)
    expect(bar).toContain('{#each plan.inline as item (item)}')
    expect(bar).toContain('{#each plan.menu as item (item)}')
  })
  // Wherever the flip is the round gutter button (beside a right-hand rail, or with izumi's own
  // toolbar, as before API 3), izumi's toolbar line for release timing is gone, so the info column
  // shows it. The rule is the plan's (toolbar-plan.test.ts); a themed toolbar elsewhere shows it.
  it('keeps the release timing in the info column wherever the flip sits in the gutter', () => {
    expect(detail).toContain("import { flipInGutter } from './toolbar-plan'")
    expect(detail).toContain('const flipGutter = $derived(media != null && flipInGutter({ ...detailTheme.episodes, total: listEpisodes(media).length, phone: $isMobile, rail: sideEpisodes }))')
    expect(detail).toContain('{#if flipGutter}')
    expect(detail).not.toContain("{#if detailTheme.episodes?.order === 'flip' && sideEpisodes}")
    expect(list).toContain('{#if !$isMobile && !selecting && !plan.gutter}')
  })
  // Entries are focused with preventScroll (the page behind a menu must not move), so the lists scroll
  // themselves: to the chosen entry on open, and with the d-pad as the scroll container nav reveals in.
  it('reveals the chosen entry inside its scrolling menu without moving the page', () => {
    const bar = read('./EpisodeToolbar.svelte')
    expect(bar.match(/ data-nav-scroll-container(?!`)/g)?.length).toBe(3)
    expect(bar).toContain('data-variant="range" data-nav-trap data-nav-escape style={rangePlace} data-nav-scroll-container')
    expect(bar).toContain('data-variant="more" data-nav-trap data-nav-escape style={menuPlace} data-nav-scroll-container')
    expect(bar).toContain('<div bind:this={menuPanel} data-part="episodes.menu" data-variant="more" data-nav-scroll-container')
    expect(bar).toContain('centreInList(root, target)')
    expect(bar).toContain('target?.focus({ preventScroll: true })')
  })
  it('keeps the legacy flip path for a theme that sets only the order', () => {
    expect(list).toContain('rail: episodesOnSide($themePresentation, !$isMobile),')
    expect(list).toContain('{:else if flipOrder && !$isMobile && !selecting}')
    expect(list).not.toContain('railGutter')
  })
})
