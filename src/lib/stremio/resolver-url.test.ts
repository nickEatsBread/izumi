import { describe, expect, it } from 'vitest'
import { hostedRouteInfoHash, torrentioResolverInfoHash } from './resolver-url'

const HASH = '161c22aecdc3ed95fb629c275ee23f77ca601f3c'

describe('torrentioResolverInfoHash', () => {
  it('recovers the public hash from a Torrentio Real-Debrid resolver URL', () => {
    expect(torrentioResolverInfoHash(
      `https://torrentio.strem.fun/resolve/realdebrid/private-token/${HASH}/null/undefined/release.mkv`,
    )).toBe(HASH)
  })

  it('supports self-hosted Torrentio when the addon name identifies it', () => {
    expect(torrentioResolverInfoHash(
      `https://streams.example/resolve/torbox/private-token/${HASH}/4/release.mkv`,
      'Torrentio',
    )).toBe(HASH)
  })

  it('does not reinterpret unrelated HTTP media as a torrent', () => {
    expect(torrentioResolverInfoHash(`https://video.example/resolve/realdebrid/token/${HASH}/movie.mp4`)).toBeUndefined()
    expect(torrentioResolverInfoHash('https://torrentio.strem.fun/video/movie.mp4')).toBeUndefined()
  })
})

describe('hostedRouteInfoHash', () => {
  it('recovers the hash a gateway playback route names in its path', () => {
    expect(hostedRouteInfoHash(`https://gateway.example/cfg-token/playback/${HASH}/0/Release.mkv`)).toBe(HASH)
    expect(hostedRouteInfoHash(`https://gateway.example/api/stream/${HASH.toUpperCase()}`)).toBe(HASH)
  })

  it('recovers the hash from a query parameter that names it', () => {
    expect(hostedRouteInfoHash(`https://gateway.example/provider/secret/stream?info_hash=${HASH}&file_index=2`)).toBe(HASH)
  })

  it('accepts a base32 hash after a routing word', () => {
    const base32 = 'abcdefghijklmnopqrstuvwxyz234567'
    expect(hostedRouteInfoHash(`https://gateway.example/resolve/${base32}/file.mkv`)).toBe(base32)
  })

  it('leaves signed media paths and ordinary files alone', () => {
    expect(hostedRouteInfoHash(`https://cdn.example/${HASH}/movie.mp4`)).toBeUndefined()
    expect(hostedRouteInfoHash(`https://cdn.example/video/movie.mp4?sig=${HASH}`)).toBeUndefined()
    expect(hostedRouteInfoHash('https://cdn.example/stream/movie.mp4')).toBeUndefined()
    expect(hostedRouteInfoHash('not a url')).toBeUndefined()
    expect(hostedRouteInfoHash(undefined)).toBeUndefined()
  })
})
