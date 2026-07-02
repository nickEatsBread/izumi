import { describe, it, expect } from 'vitest'
import { streamId, rankStreams } from './addon'
describe('addon', () => {
  it('builds a kitsu series stream id with episode', () => expect(streamId(11, 3)).toBe('kitsu:11:3'))
  it('omits episode when undefined (movie/OVA)', () => expect(streamId(11)).toBe('kitsu:11'))
  it('ranks higher resolution first', () => {
    const s = rankStreams([
      { url: 'a', name: 'Torrentio\n720p', title: 't' },
      { url: 'b', name: 'Torrentio\n1080p', title: 't' },
      { url: 'c', name: 'Torrentio\n4k', title: 't' },
    ] as any)
    expect(s.map(x => x.url)).toEqual(['c', 'b', 'a'])
  })
})
