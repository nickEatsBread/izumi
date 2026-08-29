import { describe, expect, it } from 'vitest'
import { dedupeJvmSources, isJvmHostedVideoUrl, normalizeJvmSidecarUrl, parseJvmVideoTitle } from './jvm-video'

describe('JVM video metadata', () => {
  it('marks only JVM localhost servers as host-shareable', () => {
    expect(isJvmHostedVideoUrl('http://localhost:43123/video')).toBe(true)
    expect(isJvmHostedVideoUrl('http://127.0.0.1:43123/video')).toBe(true)
    expect(isJvmHostedVideoUrl('https://cdn.example/video')).toBe(false)
    expect(isJvmHostedVideoUrl('file:///tmp/video')).toBe(false)
  })

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
    expect(parseJvmVideoTitle('Kiwi - H-Sub - 480p')).toEqual({
      server: 'Kiwi',
      quality: '480p',
      audio: 'sub',
      subtitleMode: 'hard',
    })
  })

  it('keeps a literal leading JVM variant label when no explicit server field exists', () => {
    expect(parseJvmVideoTitle('Japanese - 1080p (1920x1080) - 543.65 KB/s')).toEqual({
      server: 'Japanese',
      quality: '1080p',
    })
    expect(parseJvmVideoTitle('English - 720p (1280x720) - 323.10 KB/s')).toEqual({
      server: 'English',
      quality: '720p',
    })
  })

  it('does not invent a server for a quality-only title', () => {
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
