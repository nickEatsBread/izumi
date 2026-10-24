import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('ranked catalog sections', () => {
  const row = read('./CatalogSectionRow.svelte')

  it('renders stable client-native numerals for Top 10 shelves', () => {
    expect(row).not.toContain('<svg')
    expect(row).toContain('class="rank-number')
    expect(row).toContain("font-family: 'Nunito Variable'")
    expect(row).toContain("font-variation-settings: 'wght' 950")
    expect(row).toContain("font-feature-settings: 'tnum' 1")
    expect(row).not.toContain('-webkit-text-stroke')
  })

  // A theme's Top 10 card (`rankPosition`) needs the card's place on every catalog, as AniList rows give it.
  it('tells each card of a plain row its place in the row', () => {
    expect(row).toContain('{#each section.media as media, index (media.catalog?.id ?? media.id)}')
    expect(row).toContain('<div class="shrink-0"><SmallCard {media} {showCatalogSource} position={index + 1} /></div>')
  })
})
