import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(new URL('./AnimeDetail.svelte', import.meta.url), 'utf8')

describe('series title art', () => {
  it('loads the extras the page and its header template bind', () => {
    expect(detail).toContain('const needs = templateNeeds(detailTheme.header)')
    expect(detail).toContain("if (detailTheme.art === 'keyart') needs.add('keyart')")
    expect(detail).toContain("if (detailTheme.title === 'logo') needs.add('logo')")
    expect(detail).toContain('loadTitleExtras(target, needs)')
    expect(detail).toContain('...detailExtras')
  })
  it('paints key art behind the overlay layouts and names the pieces', () => {
    expect(detail.match(/data-part="detail\.backdrop"/g)?.length).toBe(4)
    expect(detail.match(/data-part="detail\.body"/g)?.length).toBe(2)
    expect(detail).toContain('data-part="detail.studio"')
    expect(detail).toContain('data-part="detail.rating"')
  })
  it('renders the title through one snippet that can show the logo', () => {
    expect(detail).toContain('{#snippet seriesTitle(m: Media, className: string)}')
    expect(detail).toContain('data-part="detail.logo"')
    expect(detail.match(/\{@render seriesTitle\(m, /g)?.length).toBe(4)
  })
})
