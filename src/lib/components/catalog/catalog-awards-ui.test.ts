import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(fileURLToPath(new URL('./CatalogMediaDetail.svelte', import.meta.url)), 'utf8')
const awards = readFileSync(fileURLToPath(new URL('./CatalogAwards.svelte', import.meta.url)), 'utf8')
const hero = readFileSync(fileURLToPath(new URL('../banner/Hero.svelte', import.meta.url)), 'utf8')
const catalogHome = readFileSync(fileURLToPath(new URL('./CatalogHome.svelte', import.meta.url)), 'utf8')
const homeSettings = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/catalog/home/+page.svelte', import.meta.url)), 'utf8')
const tmdb = readFileSync(fileURLToPath(new URL('../../catalog/providers/tmdb.ts', import.meta.url)), 'utf8')

describe('catalogue discovery context UI', () => {
  it('places optional award intelligence on TMDB and Stremio detail heroes', () => {
    expect(detail).toContain('<CatalogAwards {media} />')
    expect(awards).toContain("media.catalog?.provider === 'tmdb' || media.catalog?.provider === 'stremio'")
    expect(awards).toContain('Crunchyroll winner')
    expect(awards).toContain('fetchAwardSummary(imdbId, abort.signal)')
    expect(awards).toContain('providerAwardName')
    expect(awards).toContain('namedProviderAward')
    expect(awards).toContain('item.recognitions')
    expect(awards).toContain('recognitions.slice(1, 3)')
    expect(awards).toContain('+{hiddenGeneral} more')
    expect(awards).not.toContain('`${item.wins} wins`')
    expect(awards).toContain('w-fit max-w-[calc(100%-2.5rem)]')
    expect(awards).toContain('size-8')
    expect(detail).not.toContain('Stremio metadata')
  })

  it('explains ranked and award-driven featured placements', () => {
    expect(hero).toContain('`#${current.featuredRank.position} in ${current.featuredRank.label}`')
    expect(hero).toContain('Crunchyroll · {featuredAward.year} {featuredAward.category} winner')
    // Netflix-style floating rank: a red TOP 10 mark for top-ten placements, bare shadowed text
    // otherwise, anchored bottom-right clear of the edge controls.
    expect(hero.match(/bg-\[#e50914\]/g)?.length).toBe(2)
    expect(hero.match(/\{#if featuredRankPosition <= 10\}/g)?.length).toBe(2)
    expect(hero).toContain("pointer-events-none absolute right-8 flex items-center gap-2 {medias.length > 1 ? 'bottom-16' : 'bottom-8'}")
    expect(hero.match(/drop-shadow-\[2px_2px_4px_rgba\(0,0,0,\.9\)\]">\{featuredRankLabel\}/g)?.length).toBe(2)
    expect(tmdb).toContain("'Movies Today'")
    expect(tmdb).toContain("'TV Today'")
  })

  it('lets Stremio users choose a backdrop or full cover-art banner treatment', () => {
    expect(homeSettings).toContain("title: 'Cinematic backdrop'")
    expect(homeSettings).toContain("title: 'Cover art'")
    expect(catalogHome).toContain('artworkMode={$catalogProvider')
    expect(hero).toContain("artworkMode === 'cover'")
  })
})
