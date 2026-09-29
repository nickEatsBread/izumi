import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(new URL('./AnimeDetail.svelte', import.meta.url), 'utf8')

describe('series title art', () => {
  it('loads the extras the page and its header template bind', () => {
    expect(detail).toContain('const needs = templateNeeds(detailTheme.header)')
    // Only the overlay layouts draw key art; stack and split never show it.
    expect(detail).toContain("if (detailTheme.art === 'keyart' && detailTheme.layout === 'overlay') needs.add('keyart')")
    expect(detail).toContain("if (detailTheme.title === 'logo') needs.add('logo')")
    expect(detail).toContain('...detailExtras')
  })
  it('loads the artwork apart from the slower rating and audio lookups, and waits for the artwork only', () => {
    expect(detail).toContain('const art = artNeeds(needs)')
    expect(detail).toContain('const meta = metaNeeds(needs)')
    expect(detail).toContain('loadTitleExtras(target, art)')
    expect(detail).toContain('loadTitleExtras(target, meta)')
    expect(detail).toContain('detailExtrasSettled = !art.size')
    expect(detail).not.toContain('loadTitleExtras(target, needs)')
  })
  it('paints key art behind the overlay layouts and names the pieces', () => {
    // Two overlay layouts (phone, desktop), each with the artwork and its blurred-cover fallback.
    expect(detail.match(/data-part="detail\.backdrop"/g)?.length).toBe(4)
    expect(detail.match(/data-part="detail\.body"/g)?.length).toBe(2)
    expect(detail).toContain('data-part="detail.studio"')
    expect(detail).toContain('data-part="detail.rating"')
  })
  it('falls back from broken key art to the banner, then to the blurred cover', () => {
    expect(detail).toContain('let failedBackdrops = $state<string[]>([])')
    expect(detail).toContain('!failedBackdrops.includes(src)')
    // Both artwork images report their failure; the blurred cover is the last resort.
    expect(detail.match(/onerror=\{\(event\) => backdropFailed\(event\.currentTarget\.getAttribute\('src'\)\)\}/g)?.length).toBe(2)
  })
  it('renders the title through one snippet that can show the logo', () => {
    expect(detail).toContain('{#snippet seriesTitle(m: Media, className: string)}')
    expect(detail).toContain('data-part="detail.logo"')
    expect(detail.match(/\{@render seriesTitle\(m, /g)?.length).toBe(5)
  })
  it('keeps the waiting title readable to screen readers', () => {
    // `invisible` (visibility: hidden) also hides it from assistive technology; opacity does not.
    expect(detail).toContain("detailTheme.title === 'logo' && !detailExtrasSettled ? 'opacity-0' : ''")
    expect(detail).not.toContain("!detailExtrasSettled ? 'invisible'")
  })
})
