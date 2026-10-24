import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const detail = read('./AnimeDetail.svelte')
const catalog = read('../catalog/CatalogMediaDetail.svelte')
const preview = read('../cards/PreviewCard.svelte')

describe('series page trailers (API 6 detail.preview: "trailer")', () => {
  it('the desktop overlay plays one behind the title, after the art and before the scrims', () => {
    const start = detail.indexOf('data-layout="overlay" data-variant="desktop"')
    const section = detail.slice(start, detail.indexOf('</section>', start))
    expect(start).toBeGreaterThan(-1)
    expect(section).toMatch(/<BackdropTrailer id=\{youtubeTrailerId\(m\.trailer\)\} title=\{title\(m\)\} enabled=\{detailTheme\.preview === 'trailer'\} dwell=\{DETAIL_TRAILER_DWELL\}\s+part="detail\.video" mutePart="detail\.mute" muteClass="[^"]*z-\d+[^"]*" \/>/)
    const trailer = section.indexOf('<BackdropTrailer')
    expect(trailer).toBeGreaterThan(section.indexOf('{#if headerSrc}'))
    expect(trailer).toBeGreaterThan(section.indexOf('class="!absolute inset-0 skeloader"'))
    expect(trailer).toBeLessThan(section.indexOf('data-part="detail.scrim"'))
    expect(trailer).toBeLessThan(section.indexOf('data-part="detail.body"'))
    // The scrims paint over the trailer's layer; they must not swallow the mute button's clicks.
    for (const scrim of section.match(/<div data-part="detail\.scrim"[^>]*>/g) ?? []) expect(scrim).toContain('pointer-events-none')
    expect(section.match(/data-part="detail\.scrim"/g)?.length).toBe(2)
  })

  it('imports the wrapper, the dwell and the id helper; the phone branches get none', () => {
    expect(detail).toContain("import BackdropTrailer from '$lib/components/cards/BackdropTrailer.svelte'")
    expect(detail).toContain("import { DETAIL_TRAILER_DWELL } from '$lib/components/cards/backdrop-trailer'")
    expect(detail).toContain("import { youtubeTrailerId } from '$lib/components/cards/youtube-embed'")
    expect(detail.match(/<BackdropTrailer/g)?.length).toBe(1)
  })

  it('a movie or show from a catalog plays one after its backdrop', () => {
    expect(catalog).toContain("import BackdropTrailer from '$lib/components/cards/BackdropTrailer.svelte'")
    expect(catalog).toContain("import { DETAIL_TRAILER_DWELL } from '$lib/components/cards/backdrop-trailer'")
    expect(catalog).toContain("import { youtubeTrailerId } from '$lib/components/cards/youtube-embed'")
    expect(catalog).toContain("import { resolveDetail } from '$lib/themes/presentation'")
    expect(catalog).toContain("import { themePresentation } from '$lib/themes/runtime'")
    expect(catalog).toContain('const detailTheme = $derived(resolveDetail($themePresentation))')
    expect(catalog).toContain("const trailerOn = $derived(detailTheme.preview === 'trailer')")
    expect(catalog).toMatch(/<BackdropTrailer id=\{youtubeTrailerId\(media\.trailer\)\} title=\{title\(media\)\} enabled=\{trailerOn\} dwell=\{DETAIL_TRAILER_DWELL\}\s+part="detail\.video" mutePart="detail\.mute" muteClass="[^"]*z-\d+[^"]*" \/>/)
    expect(catalog.indexOf('<BackdropTrailer')).toBeGreaterThan(catalog.indexOf('<img data-part="detail.backdrop"'))
    // Everything painted after it passes clicks through to the mute button, except the title block and cover.
    expect(catalog).toContain('sm:px-8 pointer-events-none [&>*]:pointer-events-auto">')
    expect(catalog.match(/class="pointer-events-none absolute inset-0 bg-gradient-/g)?.length).toBe(2)
    expect(catalog.indexOf('<BackdropTrailer')).toBeLessThan(catalog.indexOf('<button data-focusable onclick={() => history.length > 1'))
  })

  it('the card preview takes its trailer id from the shared helper', () => {
    expect(preview).toContain("import { youtubeTrailerId } from './youtube-embed'")
    expect(preview).toContain('const trailerId = $derived(youtubeTrailerId(media.trailer))')
    expect(preview).not.toContain("toLowerCase() === 'youtube'")
  })
})
