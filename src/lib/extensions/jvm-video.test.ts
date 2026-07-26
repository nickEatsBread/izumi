import { describe, expect, it } from 'vitest'
import { isKnownBrokenJvmVideo, parseJvmVideoTitle } from './jvm-video'

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

  it('rejects only the proven corrupt VidPlay kotocdn loopback transport', () => {
    const bad = 'http://localhost:52610/m3u8?url=https%3A%2F%2Fvidtub.kotocdn.site%2Fx%2F1080.m3u8'
    expect(isKnownBrokenJvmVideo(bad, 'VidPlay-1')).toBe(true)
    expect(isKnownBrokenJvmVideo(bad, 'HD-1')).toBe(false)
    expect(isKnownBrokenJvmVideo('https://cdn.mewstream.buzz/x/index.m3u8', 'VidPlay-1')).toBe(false)
    expect(isKnownBrokenJvmVideo(
      'http://localhost:1234/m3u8?url=https%3A%2F%2Fother.example%2Fx.m3u8',
      'VidPlay-1',
    )).toBe(false)
  })
})
