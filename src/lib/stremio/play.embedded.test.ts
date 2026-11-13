import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { embeddedVideoStreams } from './play'

const media = (streams: unknown[]) => ({
  id: -1, title: { userPreferred: 'Example Show' },
  catalog: { provider: 'stremio', type: 'series', id: 'x', addonId: 'meta-addon' },
  videos: [{ id: 'tt0000001:1:1', number: 1, season: 1, episode: 1, streams }],
}) as unknown as Media

describe('streams a metadata add-on embeds in its videos', () => {
  it('asks the stream sources when a video lists none', () => {
    expect(embeddedVideoStreams(media([]), 1)).toEqual({ declared: false, streams: [] })
  })
  it('plays the streams a video lists', () => {
    const result = embeddedVideoStreams(media([{ url: 'https://cdn.test/1.mp4', name: 'Example' }]), 1)
    expect(result.declared).toBe(true)
    expect(result.streams.map((stream) => stream.url)).toEqual(['https://cdn.test/1.mp4'])
  })
})
