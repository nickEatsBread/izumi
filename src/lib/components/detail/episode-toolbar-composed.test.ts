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
    expect(list).toContain('{#if railGutter && aired > 0}')
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
  // Enabled with the AnimeDetail.svelte half of this change, which lands in a separate commit.
  it.skip('keeps the release timing beside a right-hand rail flip only', () => {
    expect(detail).toContain("{#if detailTheme.episodes?.order === 'flip' && sideEpisodes}")
  })
})
