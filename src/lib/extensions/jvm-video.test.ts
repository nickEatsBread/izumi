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

  it('reads Sub and Dub wherever an extension puts them in the title', () => {
    expect(parseJvmVideoTitle('Mirror B - 0p Dub HLS')).toEqual({
      server: 'Mirror B',
      quality: 'Mirror B - 0p Dub HLS',
      audio: 'dub',
    })
    expect(parseJvmVideoTitle('Mirror C - 0p Sub HLS')).toMatchObject({ server: 'Mirror C', audio: 'sub' })
    expect(parseJvmVideoTitle('Mirror A - 0p Sub EMBEDHost - 1080p')).toEqual({
      server: 'Mirror A',
      quality: '1080p',
      audio: 'sub',
    })
    expect(parseJvmVideoTitle('Mirror B - 1080p Soft Sub HLS')).toMatchObject({ audio: 'sub', subtitleMode: 'soft' })
    expect(parseJvmVideoTitle('Mirror D - 720p Hard Sub')).toMatchObject({ audio: 'sub', subtitleMode: 'hard' })
    expect(parseJvmVideoTitle('Server 2 [English Dubbed] 720p')).toMatchObject({ audio: 'dub', quality: '720p' })
    expect(parseJvmVideoTitle('Host - Latino')).toMatchObject({ audio: 'dub' })
    expect(parseJvmVideoTitle('Host - Subtitulado')).toMatchObject({ audio: 'sub' })
  })

  it('reads an audio-language badge copied into the title', () => {
    expect(parseJvmVideoTitle('SubsGroup · 1080p (98MB) eng')).toEqual({
      quality: '1080p',
      audio: 'dub',
    })
    expect(parseJvmVideoTitle('SubsGroup · 720p (60MB) jpn')).toMatchObject({ audio: 'sub' })
    // A fansub group named "Subs…" is not a subtitle marker.
    expect(parseJvmVideoTitle('SubsGroup · 1080p (98MB)').audio).toBeUndefined()
  })

  it('leaves the flavour unknown when a title names both or neither', () => {
    expect(parseJvmVideoTitle('Mirror - Sub & Dub - 1080p').audio).toBeUndefined()
    expect(parseJvmVideoTitle('Mirror - Dual Audio - 1080p').audio).toBeUndefined()
    expect(parseJvmVideoTitle('English - 720p (1280x720) - 323.10 KB/s').audio).toBeUndefined()
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
