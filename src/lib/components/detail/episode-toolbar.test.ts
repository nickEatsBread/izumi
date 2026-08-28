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
    expect(src).toContain('{#if $isMobile && searchOpen}')
    expect(src).toContain('{#if !$isMobile}')
  })
})

describe('desktop episode toolbar', () => {
  it('orders sort, search, Random, and Download on one desktop row', () => {
    const toolbar = src.slice(src.indexOf('<div class="mb-4 grid'), src.indexOf('{#if $isMobile && searchOpen}'))
    expect(toolbar.indexOf('Oldest')).toBeGreaterThan(-1)
    expect(toolbar.indexOf('Newest')).toBeGreaterThan(toolbar.indexOf('Oldest'))
    expect(toolbar.indexOf('Find episode number or title')).toBeGreaterThan(toolbar.indexOf('Newest'))
    expect(toolbar.indexOf('<Shuffle size={15} /> Random')).toBeGreaterThan(toolbar.indexOf('Find episode number or title'))
    expect(toolbar.indexOf('Download…')).toBeGreaterThan(toolbar.indexOf('<Shuffle size={15} /> Random'))
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
