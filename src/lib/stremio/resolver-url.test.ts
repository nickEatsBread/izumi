import { describe, expect, it } from 'vitest'
import { torrentioResolverInfoHash } from './resolver-url'

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
