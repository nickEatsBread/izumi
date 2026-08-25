import { describe, expect, it } from 'vitest'
import { detailTags, isSpoilerTag } from './detail-tags'

describe('detail tag spoiler protection', () => {
  it('protects both general and title-specific spoiler tags', () => {
    expect(isSpoilerTag({ name: 'Ordinary tag' })).toBe(false)
    expect(isSpoilerTag({ name: 'General reveal', isGeneralSpoiler: true })).toBe(true)
    expect(isSpoilerTag({ name: 'Title reveal', isMediaSpoiler: true })).toBe(true)
  })

  it('keeps spoiler tags in the detail list so the UI can offer an explicit reveal', () => {
    const tags = [
      { name: 'Lower rank', rank: 40 },
      { name: 'Protected', rank: 90, isMediaSpoiler: true },
      { name: 'Middle rank', rank: 60 },
    ]

    expect(detailTags(tags, 2, true).map((tag) => tag.name)).toEqual(['Protected', 'Middle rank'])
    expect(tags.map((tag) => tag.name)).toEqual(['Lower rank', 'Protected', 'Middle rank'])
  })
})
