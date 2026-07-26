import { describe, expect, it } from 'vitest'
import { parseJvmVideoTitle } from './jvm-video'

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
})
