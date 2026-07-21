import { describe, expect, it } from 'vitest'
import { parseSharedSource, shareableSource, sharedSourceKey, streamFromSharedSource } from './source'

describe('Watch Together source sharing', () => {
  it('shares a torrent identity instead of its resolved debrid URL', () => {
    const result = shareableSource({
      infoHash: '0123456789ABCDEF0123456789ABCDEF01234567',
      url: 'https://debrid.example/private-file',
      behaviorHints: { filename: 'Series.S01E02.mkv', videoSize: 1234 },
    })
    expect(result.error).toBe('')
    expect(result.source).toEqual({
      version: 1,
      kind: 'torrent',
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      filename: 'Series.S01E02.mkv',
      videoSize: 1234,
      bingeGroup: undefined,
      name: undefined,
      title: undefined,
    })
    expect(JSON.stringify(result)).not.toContain('debrid.example')
  })

  it('recovers Torrentio resolver hashes without sharing the path token', () => {
    const hash = '161c22aecdc3ed95fb629c275ee23f77ca601f3c'
    const result = shareableSource({
      url: `https://torrentio.strem.fun/resolve/realdebrid/private-token/${hash}/null/undefined/release.mkv`,
      name: '[RD+] Torrentio',
      behaviorHints: { filename: 'release.mkv' },
    })
    expect(result.source).toMatchObject({ kind: 'torrent', infoHash: hash, filename: 'release.mkv' })
    expect(JSON.stringify(result)).not.toContain('private-token')
  })

  it('round-trips an exact torrent and file hint for local resolution', () => {
    const source = shareableSource({
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      behaviorHints: { filename: 'Episode 08.mkv', bingeGroup: 'release-a' },
    }).source!
    expect(streamFromSharedSource(source)).toMatchObject({
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      behaviorHints: { filename: 'Episode 08.mkv', bingeGroup: 'release-a' },
    })
    expect(sharedSourceKey(source)).toContain('Episode 08.mkv')
  })

  it('accepts a credential-free direct HTTP source', () => {
    expect(shareableSource({ url: 'https://media.example/episode.mkv?quality=1080#fragment' }).source)
      .toEqual({ version: 1, kind: 'http', url: 'https://media.example/episode.mkv?quality=1080', filename: undefined, videoSize: undefined, name: undefined, title: undefined })
  })

  it.each([
    { url: 'https://user:pass@media.example/video' },
    { url: 'https://media.example/video?access_token=private' },
    { url: 'file:///home/user/video.mkv' },
    { url: 'https://media.example/video', __headers: { Authorization: 'Bearer private' } },
  ])('does not share credential-bearing or host-local sources', (stream) => {
    const result = shareableSource(stream)
    expect(result.source).toBeNull()
    expect(result.error).not.toBe('')
  })

  it('validates sources received from a peer', () => {
    expect(parseSharedSource({ version: 1, kind: 'http', url: 'https://media.example/e1.mkv' }))
      .toMatchObject({ kind: 'http', url: 'https://media.example/e1.mkv' })
    expect(parseSharedSource({ version: 1, kind: 'http', url: 'https://media.example/e1?token=private' })).toBeNull()
    expect(parseSharedSource({ version: 99, kind: 'torrent', infoHash: '0123456789abcdef0123456789abcdef01234567' })).toBeNull()
  })
})
