import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')

describe('mobile episode toolbar', () => {
  it('does not expose the old progress-tools clutter', () => {
    expect(src).not.toContain('Progress tools')
    expect(src).not.toContain('progressTarget')
  })

  it('puts search beside the mobile layout controls and gates the field', () => {
    expect(src).toContain('aria-label="Search episodes"')
    expect(src).toContain('{#if $isMobile && searchOpen && showEpisodeSearch}')
    expect(src).toContain('{#if !$isMobile}')
  })
})

describe('desktop episode toolbar', () => {
  it('orders sort, search, and Download on one desktop row', () => {
    const toolbar = src.slice(src.indexOf('<div class="mb-4 grid'), src.indexOf('{#if $isMobile && searchOpen}'))
    expect(toolbar.indexOf('Oldest')).toBeGreaterThan(-1)
    expect(toolbar.indexOf('Newest')).toBeGreaterThan(toolbar.indexOf('Oldest'))
    expect(toolbar.indexOf('Find episode number or title')).toBeGreaterThan(toolbar.indexOf('Newest'))
    expect(toolbar.indexOf('Download')).toBeGreaterThan(toolbar.indexOf('Find episode number or title'))
    expect(src).not.toContain('Random')
    expect(src).not.toContain('Shuffle')
    expect(src).toContain('{:else if selecting || ($isMobile && !offline)}')
  })

  it('keeps the Any/Sub/Dub segmented control level with its neighboring selects', () => {
    expect(src.match(/<div class="flex h-9[^\n]+items-stretch/g)?.length).toBe(2)
    expect(src.match(/class="h-full rounded/g)?.length).toBe(6)
  })

  it('anchors the release schedule after Download at the far right of the episode toolbar', () => {
    const toolbar = src.slice(src.indexOf('<div class="mb-4 grid'), src.indexOf('{#if $isMobile && searchOpen}'))
    expect(toolbar.indexOf('<AiringStatus {media} toolbar />')).toBeGreaterThan(toolbar.indexOf('Download…'))
    expect(toolbar).toContain('col-span-2 ml-auto flex shrink-0 items-center gap-3')
  })
})

describe('episode toolbar hooks', () => {
  it("names izumi's own toolbar and its controls", () => {
    expect(src).toContain('<div class="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap" data-slot="episodes.toolbar" data-variant="bar">')
    expect(src).toContain('<div class="mb-3 flex justify-end" data-slot="episodes.toolbar" data-variant="bar">')
    expect(src).toContain('<div class="flex rounded-lg bg-secondary p-0.5 text-sm font-bold" data-part="episodes.sort" data-variant="tabs" data-dir={sortDir}>')
    expect(src).toContain('<div class="flex min-h-11 w-full items-stretch rounded-xl bg-secondary p-1 text-sm font-bold" data-part="episodes.sort" data-variant="tabs" data-dir={sortDir}>')
    expect(src).toContain('class="episode-order-flip" data-part="episodes.sort" data-variant="flip" data-dir={sortDir}')
    expect(src).toContain('<label class="relative col-span-2 min-w-0 sm:max-w-sm sm:flex-1" data-part="episodes.search">')
    expect(src).toContain('<label class="relative mb-4 block min-w-0" data-part="episodes.search">')
    expect(src).toContain("data-part={layoutSwitch ? 'episodes.layout' : undefined} data-layout={$episodeLayout}")
    expect(src.match(/onclick=\{startSelect\} data-part="episodes\.download"/g)?.length).toBe(2)
    expect(src).toContain('class="episode-order-flip episode-download-flip" data-part="episodes.download"')
    expect(src.match(/onclick=\{queueNextEpisode\} data-part="episodes\.queue"/g)?.length).toBe(3)
  })
  it('only offers the cards/numbers switch where the arrangement honours it', () => {
    expect(src).toContain("const layoutSwitch = $derived(episodeTheme?.arrangement !== 'grid' && episodeTheme?.arrangement !== 'carousel')")
    expect(src).toContain('{#if layoutSwitch || showEpisodeSearch}')
    expect(src).toContain('{#if layoutSwitch}')
  })
})
