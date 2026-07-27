import { describe, expect, it } from 'vitest'
import { buildStreamIds } from './stream-ids'
import { acceptsStreamId } from './manifest'

describe('buildStreamIds', () => {
  it('asks for the kitsu episode id first — it is what anime addons index by', () => {
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3 })).toEqual(['kitsu:42:3'])
  })

  it('omits the episode for a movie', () => {
    expect(buildStreamIds({ type: 'movie', kitsu: 42 })).toEqual(['kitsu:42'])
  })

  it('adds the imdb triple when the mapping gives a confident season and episode', () => {
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3, imdb: 'tt123', season: 1, imdbEpisode: 3 }))
      .toEqual(['kitsu:42:3', 'tt123:1:3'])
  })

  it('never guesses the imdb triple without a mapped season and episode', () => {
    // An unaligned triple reintroduces exactly the cross-season mismatch the season verifier
    // exists to clean up, so no mapping means no imdb query at all.
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3, imdb: 'tt123' })).toEqual(['kitsu:42:3'])
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3, imdb: 'tt123', season: 1 })).toEqual(['kitsu:42:3'])
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3, imdb: 'tt123', imdbEpisode: 3 })).toEqual(['kitsu:42:3'])
  })

  it('skips a specials season, which addons do not index by that triple', () => {
    expect(buildStreamIds({ type: 'series', kitsu: 42, episode: 3, imdb: 'tt123', season: 0, imdbEpisode: 3 }))
      .toEqual(['kitsu:42:3'])
  })

  it('uses the bare imdb id for a movie', () => {
    expect(buildStreamIds({ type: 'movie', kitsu: 42, imdb: 'tt123' })).toEqual(['kitsu:42', 'tt123'])
  })

  it('still produces the imdb id when there is no kitsu mapping at all', () => {
    expect(buildStreamIds({ type: 'series', episode: 3, imdb: 'tt123', season: 2, imdbEpisode: 5 }))
      .toEqual(['tt123:2:5'])
  })

  it('produces nothing when there is nothing to ask with', () => {
    expect(buildStreamIds({ type: 'series', episode: 3 })).toEqual([])
  })
})

describe('acceptsStreamId', () => {
  const res = (r: unknown[]) => ({ id: 'a', name: 'A', version: '1', resources: r } as never)

  it('accepts an addon whose stream resource lists the prefix and type', () => {
    const m = res([{ name: 'stream', types: ['series'], idPrefixes: ['kitsu:'] }])
    expect(acceptsStreamId(m, 'series', 'kitsu:42:3')).toBe(true)
  })

  it('rejects an id namespace the addon does not list', () => {
    // This is the whole point: a stream addon configured only for imdb ids was queried with a
    // kitsu id on every play, always returned nothing, and still counted toward the wait.
    const m = res([{ name: 'stream', types: ['series'], idPrefixes: ['tt'] }])
    expect(acceptsStreamId(m, 'series', 'kitsu:42:3')).toBe(false)
    expect(acceptsStreamId(m, 'series', 'tt123:1:3')).toBe(true)
  })

  it('rejects a type the addon does not serve', () => {
    const m = res([{ name: 'stream', types: ['movie'], idPrefixes: ['kitsu:'] }])
    expect(acceptsStreamId(m, 'series', 'kitsu:42:3')).toBe(false)
  })

  it('rejects an addon with no stream resource at all', () => {
    expect(acceptsStreamId(res([{ name: 'meta', types: ['series'] }]), 'series', 'kitsu:42:3')).toBe(false)
  })

  it('falls back to the top-level types and idPrefixes for a bare string resource', () => {
    const m = { id: 'a', name: 'A', version: '1', resources: ['stream'], types: ['series'], idPrefixes: ['kitsu:'] } as never
    expect(acceptsStreamId(m, 'series', 'kitsu:42:3')).toBe(true)
    expect(acceptsStreamId(m, 'series', 'tt123:1:3')).toBe(false)
  })

  it('accepts anything when the addon declares no prefixes', () => {
    const m = res([{ name: 'stream', types: ['series'] }])
    expect(acceptsStreamId(m, 'series', 'kitsu:42:3')).toBe(true)
  })

  it('accepts when the manifest could not be fetched — never gate on missing information', () => {
    expect(acceptsStreamId(null, 'series', 'kitsu:42:3')).toBe(true)
    expect(acceptsStreamId({ id: 'a', name: 'A', version: '1' } as never, 'series', 'kitsu:42:3')).toBe(true)
  })
})
