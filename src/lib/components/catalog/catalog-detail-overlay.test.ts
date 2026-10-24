import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// A theme's overlay page (`detail.layout: "overlay"`) is drawn for an anime's series page. A movie or
// show from another catalog must give it the same parts, or the theme's rules land on the wrong boxes.
describe('catalog title page under a theme overlay layout', () => {
  const detail = read('./CatalogMediaDetail.svelte')
  const anime = read('../detail/AnimeDetail.svelte')

  it('follows the theme overlay layout on desktop only', () => {
    expect(detail).toContain("const themedOverlay = $derived(detailTheme.layout === 'overlay' && !$isMobile)")
  })

  it('hooks both artwork fades as the anime overlay page does', () => {
    for (const source of [detail, anime]) {
      expect(source).toContain('data-part="detail.scrim" data-dir="bottom"')
      expect(source).toContain('data-part="detail.scrim" data-dir="left"')
    }
  })

  it('drops the poster and draws the theme header template, as the anime overlay page does', () => {
    expect(detail).toContain('{#if !themedOverlay}\n          <img data-part="detail.poster"')
    expect(detail).toContain('{#if themedOverlay && detailTheme.header}')
    expect(detail).toContain('<ThemeNode node={detailTheme.header} model={mediaDisplayModel(media)} />')
  })

  it('shows Save as a round icon button with an accessible name', () => {
    expect(detail).toContain("aria-label={savedLocally ? 'Saved' : 'Save to lists'}")
    expect(detail).toContain("{#if !themedOverlay}{savedLocally ? 'Saved' : 'Save'}{/if}")
    // The trailer button beside it takes the same round shape.
    expect(detail.match(/class=\{themedOverlay \? 'grid h-12 w-12 place-items-center rounded-full bg-white\/15/g)).toHaveLength(2)
    expect(anime).toContain('title="Save to lists"\n                  class="grid h-12 w-12 place-items-center rounded-full')
  })
})
