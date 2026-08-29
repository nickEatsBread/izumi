import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const card = readFileSync(fileURLToPath(new URL('./SmallCard.svelte', import.meta.url)), 'utf8')
const preview = readFileSync(fileURLToPath(new URL('./PreviewCard.svelte', import.meta.url)), 'utf8')
const detail = readFileSync(fileURLToPath(new URL('../detail/AnimeDetail.svelte', import.meta.url)), 'utf8')
const home = readFileSync(fileURLToPath(new URL('../../../routes/app/home/+page.svelte', import.meta.url)), 'utf8')
const mergedHome = readFileSync(fileURLToPath(new URL('../catalog/MergedCatalogHome.svelte', import.meta.url)), 'utf8')

describe('rating presentation', () => {
  it('keeps anime poster ratings off by default while allowing an explicit opt-in', () => {
    expect(card).toContain("media.type === 'ANIME' || media.catalog?.type === 'anime'")
    expect(card).toContain('showRating ?? !animeCard')
    expect(card).toContain('showRating?: boolean')
  })

  it('leaves the established anime detail score treatment unchanged', () => {
    expect(detail).toContain('ratingBg(m.averageScore)')
    expect(detail).toContain('{m.averageScore}%')
    expect(detail).not.toContain('<MediaRatings')
  })

  it('limits linked-account hover ratings to Automatic anime rows', () => {
    expect(card).toContain('<PreviewCard {media} {preferLinkedRating} />')
    expect(preview).toContain('preferredConnectedTracker')
    expect(preview).toContain('loadProviderCommunityRating')
    expect(home).toContain("preferLinkedRating={$catalogProvider === 'auto'}")
    expect(mergedHome).toContain("preferLinkedRating={decoded.selection === 'auto'}")
    expect(detail).not.toContain('preferLinkedRating')
  })
})
