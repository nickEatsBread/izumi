import { describe, expect, it } from 'vitest'
import { parseSharedSource, shareableSource, sharedSourceKey, streamFromSharedSource } from './source'

describe('Watch Together source sharing', () => {
  // Izumi deliberately does NOT redact the host's source: guests play the host's exact link so they
  // do not each need a debrid account. The host is warned about the account-sharing implications
  // before the room is created (DebridRoomNotice) — that warning is the mitigation, not this module.
  it('shares a resolved debrid URL as-is rather than falling back to the infohash', () => {
    const result = shareableSource({
      infoHash: '0123456789ABCDEF0123456789ABCDEF01234567',
      url: 'https://debrid.example/dl/private-token/release.mkv',
      behaviorHints: { filename: 'Series.S01E02.mkv', videoSize: 1234 },
    })
    expect(result.error).toBe('')
    expect(result.source).toMatchObject({
      kind: 'http',
      url: 'https://debrid.example/dl/private-token/release.mkv',
      filename: 'Series.S01E02.mkv',
      videoSize: 1234,
    })
  })

  it('shares a Torrentio resolver URL including its path token', () => {
    const hash = '161c22aecdc3ed95fb629c275ee23f77ca601f3c'
    const url = `https://torrentio.strem.fun/resolve/realdebrid/private-token/${hash}/null/undefined/release.mkv`
    const result = shareableSource({ url, name: '[RD+] Torrentio', behaviorHints: { filename: 'release.mkv' } })
    expect(result.source).toMatchObject({ kind: 'http', url })
  })

  it('forwards request headers so a gated source still plays for guests', () => {
    const result = shareableSource({
      url: 'https://media.example/episode.mkv',
      __headers: { Referer: 'https://media.example/', Authorization: 'Bearer private' },
    })
    expect(result.source).toMatchObject({
      kind: 'http',
      headers: { Referer: 'https://media.example/', Authorization: 'Bearer private' },
    })
  })

  it('shares the infohash when the resolved URL is the local P2P engine', () => {
    // Direct-torrent playback resolves to loopback, which is meaningless on another device.
    const result = shareableSource({
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      url: 'http://127.0.0.1:8145/stream/0/file.mkv',
      behaviorHints: { filename: 'Episode 08.mkv' },
    })
    expect(result.source).toMatchObject({ kind: 'torrent', infoHash: '0123456789abcdef0123456789abcdef01234567' })
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

  it('round-trips an http source with its headers', () => {
    const source = shareableSource({
      url: 'https://media.example/e1.mkv',
      __headers: { Referer: 'https://media.example/' },
    }).source!
    expect(streamFromSharedSource(source)).toMatchObject({
      url: 'https://media.example/e1.mkv',
      __headers: { Referer: 'https://media.example/' },
    })
  })

  it('uses a provider LAN source and preserves its DRM playback contract', () => {
    const stream = {
      url: 'http://127.0.0.1:17871/v/local/manifest.mpd',
      __drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1/license' },
      __party: {
        url: 'http://192.168.1.8:17871/share/cap/v/remote/manifest.mpd',
        __drm: {
          keySystem: 'com.widevine.alpha',
          licenseUrl: 'http://192.168.1.8:17871/share/cap/v/remote/license',
          releaseUrl: 'http://192.168.1.8:17871/share/cap/v/remote/session',
        },
        __subtitles: [{ url: 'http://192.168.1.8:17871/share/cap/v/remote/asset?u=sub', lang: 'eng' }],
      },
    }
    const source = shareableSource(stream).source!
    expect(source).toMatchObject({
      kind: 'http',
      url: stream.__party.url,
      drm: { licenseUrl: stream.__party.__drm.licenseUrl },
    })
    expect(streamFromSharedSource(source)).toMatchObject({
      url: stream.__party.url,
      __drm: { releaseUrl: stream.__party.__drm.releaseUrl },
      __subtitles: [{ lang: 'eng' }],
    })
    expect(parseSharedSource(source)).toMatchObject({ drm: { keySystem: 'com.widevine.alpha' } })
  })

  it.each([
    { stream: { url: 'file:///home/user/video.mkv' }, why: 'non-http scheme' },
    { stream: { url: 'not a url' }, why: 'unparseable' },
    { stream: {}, why: 'neither url nor infohash' },
    { stream: { infoHash: 'nothex' }, why: 'malformed infohash' },
  ])('reports an error for an unusable source ($why)', ({ stream }) => {
    const result = shareableSource(stream)
    expect(result.source).toBeNull()
    expect(result.error).not.toBe('')
  })

  it('validates sources received from a peer', () => {
    expect(parseSharedSource({ version: 1, kind: 'http', url: 'https://media.example/e1.mkv' }))
      .toMatchObject({ kind: 'http', url: 'https://media.example/e1.mkv' })
    expect(parseSharedSource({ version: 99, kind: 'torrent', infoHash: '0123456789abcdef0123456789abcdef01234567' })).toBeNull()
    expect(parseSharedSource({ version: 1, kind: 'http', url: 'file:///etc/passwd' })).toBeNull()
  })

  it('keeps only string header values from an untrusted peer', () => {
    const source = parseSharedSource({
      version: 1, kind: 'http', url: 'https://media.example/e1.mkv',
      headers: { Referer: 'https://media.example/', evil: { nested: true }, n: 5 },
    })
    expect(source).toMatchObject({ headers: { Referer: 'https://media.example/' } })
    expect(Object.keys((source as { headers: Record<string, string> }).headers)).toEqual(['Referer'])
  })
})
