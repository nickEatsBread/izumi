import { describe, expect, it } from 'vitest'
import { dedupeJvmSources, normalizeJvmSidecarUrl, parseJvmVideoTitle } from './jvm-video'

describe('JVM video metadata', () => {
  it('splits Aniyomi server, audio flavour, subtitle mode, and quality', () => {
    expect(parseJvmVideoTitle('HD-1 - Sub - 1080p')).toEqual({
      server: 'HD-1',
      quality: '1080p',
      audio: 'sub',
      subtitleMode: 'soft',
    })
    expect(parseJvmVideoTitle('VidPlay-1 - HSub - 720p')).toEqual({
      server: 'VidPlay-1',
      quality: '720p',
      audio: 'sub',
      subtitleMode: 'hard',
    })
    expect(parseJvmVideoTitle('HD-1 - Dub - 360p').audio).toBe('dub')
  })

  it('does not invent structure for an unrelated title', () => {
    expect(parseJvmVideoTitle('1080p')).toEqual({ quality: '1080p' })
  })

  it('deduplicates factory sources by their stable runtime ID', () => {
    expect(dedupeJvmSources([
      { id: '1', name: 'TioAnime factory' },
      { id: '2', name: 'Other' },
      { id: '1', name: 'TioAnime concrete' },
    ])).toEqual([
      { id: '1', name: 'TioAnime concrete' },
      { id: '2', name: 'Other' },
    ])
  })

  it('keeps HTTP and temporary file sidecars but rejects other transports', () => {
    expect(normalizeJvmSidecarUrl('https://cdn.test/en.vtt')).toBe('https://cdn.test/en.vtt')
    expect(normalizeJvmSidecarUrl('file://C:\\Temp\\decrypted.srt')).toBe('file:///C:/Temp/decrypted.srt')
    expect(normalizeJvmSidecarUrl('file:/tmp/decrypted.srt')).toBe('file:///tmp/decrypted.srt')
    expect(normalizeJvmSidecarUrl('magnet:?xt=urn:btih:test')).toBeUndefined()
    expect(normalizeJvmSidecarUrl('kind:')).toBeUndefined()
  })
})
