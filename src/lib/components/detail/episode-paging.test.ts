import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')

describe('episode paging', () => {
  it('sizes pages from the theme', () => {
    expect(list).toContain('const PER = $derived(pageSizeFor(total, episodeTheme?.pageSize))')
    expect(list).not.toContain('const PER = 48')
  })
  it('offers range chips above the list in place of the pager', () => {
    expect(list).toContain("{#if episodeTheme?.paging === 'ranges' && pages > 1 && !searchedEpisodes}")
    expect(list).toContain('data-part="episodes.ranges" bind:this={rangesRow}')
    expect(list).toContain('data-part="chip" data-active={index === curPage || undefined}')
    expect(list).toContain('row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2)')
    expect(list).toContain('{#if pages > 1 && !searchedEpisodes && pagerShown}')
    expect(list).toContain('<div data-part="episodes.pager" class="mt-4 flex items-center gap-3 text-sm">')
    expect(list.match(/<button data-part="page-number" data-focusable disabled=/g)?.length).toBe(2)
  })
  it('ranks number matches first and says when nothing matches', () => {
    expect(list).toContain('const searchedEpisodes = $derived.by(() => searchEpisodes(allEpisodes, episodeQuery, meta))')
    expect(list).toContain('const rows = $derived(searchedEpisodes ? eps : orderEpisodes(eps, dir))')
    expect(list).toContain('data-part="episodes.empty"')
  })
})
