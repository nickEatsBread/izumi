import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(new URL('./AnimeDetail.svelte', import.meta.url), 'utf8')

describe('series title art', () => {
  it('loads the extras the page and its header template bind', () => {
    expect(detail).toContain('const needs = templateNeeds(detailTheme.header)')
    // Key art backs every series-page header: first with `detail.art: "keyart"`, otherwise in place
    // of a missing or broken banner. It is the ani.zip record the page fetches anyway.
    expect(detail).toContain("needs.add('keyart')")
    expect(detail).not.toContain("detailTheme.layout === 'overlay') needs.add('keyart')")
    expect(detail).toContain("if (detailTheme.title === 'logo') needs.add('logo')")
    expect(detail).toContain('...detailExtras')
  })
  it('loads the artwork apart from the slower rating and audio lookups, and waits for the artwork only', () => {
    expect(detail).toContain('const art = artNeeds(needs)')
    expect(detail).toContain('const meta = metaNeeds(needs)')
    expect(detail).toContain('loadTitleExtras(target, art)')
    expect(detail).toContain('loadTitleExtras(target, meta)')
    // Artwork an earlier visit found counts as arrived.
    expect(detail).toContain('detailExtrasSettled = !art.size || !!found')
    expect(detail).not.toContain('loadTitleExtras(target, needs)')
  })
  it('paints the header art on every layout and names the pieces', () => {
    // The phone overlay, the phone band and the desktop overlay each paint the chosen art, and the
    // hidden cover of a title without any; the desktop banner is Hero's `hero.art`.
    expect(detail.match(/<img data-part="detail\.backdrop"/g)?.length).toBe(4)
    expect(detail.match(/data-part="detail\.body"/g)?.length).toBe(2)
    expect(detail).toContain('data-part="detail.studio"')
    expect(detail).toContain('data-part="detail.rating"')
  })
  it('moves from art that failed its retries to the next candidate, never to a blurred cover', () => {
    expect(detail).toContain('let failedBackdrops = $state<string[]>([])')
    expect(detail).toContain('failed: failedBackdrops,')
    // Every painted artwork reports its failure once its retries are spent.
    expect(detail.match(/onfailed: backdropFailed/g)?.length).toBe(3)
    expect(detail).toContain('onartworkfailed={backdropFailed}')
    expect(detail).not.toMatch(/blur-(xl|2xl)/)
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
