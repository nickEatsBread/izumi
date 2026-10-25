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
    expect(detail).toContain('{#if !themedOverlay}\n            <img data-part="detail.poster"')
    expect(detail).toContain('{#if (themedOverlay || themedStack) && detailTheme.header}')
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

// A theme that composes the series page (its sections, tabs and episode cards) composes a movie's or a
// show's page from another catalog too; without a theme the page keeps its own sections.
describe('catalog title page follows the theme series page', () => {
  const detail = read('./CatalogMediaDetail.svelte')
  const picker = read('../detail/SeasonPicker.svelte')

  it('lays out its sections as the theme lists them, stacked or in tabs', () => {
    expect(detail).toContain('const detailThemed = $derived(!!$themePresentation?.detail)')
    expect(detail).toContain('resolveSections(detailTheme.sections, { phone: $isMobile, episodesTabbed: seriesEpisodes && episodesTabbed })')
    expect(detail).toContain('<section data-slot="detail.section" data-section={id}')
    expect(detail).toContain('<h2 data-part="detail.section-title" class="mb-3 text-lg font-black {sidePad}">{sectionView.labels[id]}</h2>')
    expect(detail).toContain('<Tabs tabs={sectionTabs} labels={sectionView.labels}')
  })

  it('puts the title block under the art on a stacked page, so a theme that pins the art pins only the art', () => {
    expect(detail).toContain("const themedStack = $derived(detailThemed && detailTheme.layout !== 'overlay' && !$isMobile)")
    expect(detail).toContain("data-layout={themedStack ? detailTheme.layout : 'overlay'}")
    // The banner keeps only the artwork; the title block and the sections sit in detail.content.
    expect(detail).toMatch(/\{#if !themedStack\}\s+\{@render backButton\('z-10'\)\}/)
    expect(detail).toContain('<div data-part="detail.content" class="pointer-events-none relative z-10 -mt-[18vh] px-5 pb-16 sm:px-8 [&>*]:pointer-events-auto">')
    expect(detail).toContain('<div data-part="detail.summary" class="min-w-0 flex-1">{@render headerInfo(media)}</div>')
    expect(detail).toContain('{@render themedLower()}\n      </div>')
    expect(detail).toContain("const sidePad = $derived(themedStack ? '' : 'px-5 sm:px-8')")
    // The theme's facts template replaces the plain meta line there.
    expect(detail).toContain('<div data-part="detail.facts" class="mt-3"><ThemeNode node={factsTemplate} model={mediaDisplayModel(media)} /></div>')
  })

  it("draws the theme's episode card per episode, a season at a time", () => {
    expect(detail).toContain('data-part="episode" data-variant="template"')
    expect(detail).toContain('<ThemeNode node={episodeCard} model={episodeModel(video)} />')
    expect(detail).toContain('<div data-slot="episodes.toolbar" data-variant="header"')
    expect(detail).toContain('<SeasonPicker entries={seasonEntries} variant="dropdown" inline onpick={(index) => (pickedSeason = { title: id, season: seasonNumbers[index] })} />')
    expect(picker).toContain('onpick?: (index: number) => void')
    expect(picker).toContain('onclick={() => { onpick(index); close(true) }}')
  })

  it('keeps its own sections without a theme', () => {
    expect(detail).toContain('{#if detailThemed}')
    expect(detail).toContain('<Carousel title="Recommendations">')
    expect(detail).toContain('<h2 data-part="detail.heading" class="mb-4 text-xl font-black">Cast & crew</h2>')
  })
})
