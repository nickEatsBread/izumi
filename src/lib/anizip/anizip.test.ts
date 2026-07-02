import { describe, it, expect } from 'vitest'
import { parseEpisodes } from './index'

const RES = {
  episodes: {
    '1': { image: 'i.jpg', title: { en: 'Ep One', ja: 'x' }, rating: '7.8', overview: 'o' },
    S1: { title: { en: 'special' } },
  },
}

describe('parseEpisodes', () => {
  it('maps numeric episode keys to EpMeta', () => {
    const m = parseEpisodes(RES as any)
    expect(m[1].title).toBe('Ep One')
    expect(m[1].image).toBe('i.jpg')
    expect(m[1].rating).toBeCloseTo(7.8)
  })
  it('ignores non-numeric (special) keys', () => expect((parseEpisodes(RES as any) as any).S1).toBeUndefined())
  it('empty on missing', () => expect(Object.keys(parseEpisodes(undefined as any)).length).toBe(0))
})
