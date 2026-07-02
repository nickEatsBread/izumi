import { describe, it, expect } from 'vitest'
import { title, banner, format, ratingBg } from './media'

describe('media helpers', () => {
  it('title prefers userPreferred, falls back to TBA', () => {
    expect(title({ id: 1, title: { userPreferred: 'Frieren' } } as any)).toBe('Frieren')
    expect(title({ id: 1, title: {} } as any)).toBe('TBA')
  })
  it('banner prefers bannerImage, then youtube thumb, then cover', () => {
    expect(banner({ id: 1, title: {}, bannerImage: 'b.jpg' } as any)).toBe('b.jpg')
    expect(banner({ id: 1, title: {}, trailer: { id: 'YT', site: 'youtube' } } as any))
      .toBe('https://i.ytimg.com/vi/YT/maxresdefault.jpg')
    expect(banner({ id: 1, title: {}, coverImage: { extraLarge: 'c.jpg' } } as any)).toBe('c.jpg')
  })
  it('format maps enum to label', () => {
    expect(format({ id: 1, title: {}, format: 'TV_SHORT' } as any)).toBe('TV Short')
    expect(format({ id: 1, title: {}, format: 'MOVIE' } as any)).toBe('Movie')
  })
  it('ratingBg buckets by score', () => {
    expect(ratingBg(80)).toContain('green'); expect(ratingBg(70)).toContain('orange'); expect(ratingBg(50)).toContain('red')
  })
})
