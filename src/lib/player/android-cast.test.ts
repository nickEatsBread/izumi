import { describe, expect, it } from 'vitest'
import { castSourceDecision, castSubtitleFormat } from './android-cast'

describe('Android Cast direct-play policy', () => {
  it('accepts extensionless HLS identified by the resolver', () => {
    expect(castSourceDecision({
      url: 'http://127.0.0.1:42123/episode/manifest?id=2',
      manifest: 'hls',
    })).toMatchObject({ ok: true, contentType: 'application/vnd.apple.mpegurl' })
  })

  it('accepts a Cast-compatible Direct P2P MP4 for the LAN relay', () => {
    expect(castSourceDecision({
      url: 'http://127.0.0.1:8145/torrents/7/stream/2',
      filename: 'Episode 02.mp4',
      infoHash: '0123456789abcdef0123456789abcdef01234567',
    }, [
      { type: 'video', selected: true, codec: 'h264', codecProfile: 'High' },
      { type: 'audio', selected: true, codec: 'aac' },
    ])).toMatchObject({ ok: true, contentType: 'video/mp4' })
  })

  it('rejects local or header-bound DASH until a receiver-aware relay exists', () => {
    expect(castSourceDecision({
      url: 'http://127.0.0.1:3210/manifest',
      manifest: 'dash',
    })).toEqual({ ok: false, error: 'Header-bound or local DASH needs a dedicated Cast receiver.' })
    expect(castSourceDecision({
      url: 'https://video.example/manifest.mpd',
      headers: { Authorization: 'secret' },
    })).toEqual({ ok: false, error: 'Header-bound or local DASH needs a dedicated Cast receiver.' })
  })

  it('rejects Matroska instead of silently converting it', () => {
    expect(castSourceDecision({
      url: 'https://cdn.example/episode',
      filename: '[Group] Episode.mkv',
    })).toMatchObject({ ok: false, error: expect.stringContaining('.mkv') })
  })

  it('rejects 10-bit H.264 and DTS', () => {
    expect(castSourceDecision({ url: 'https://cdn.example/e.mp4' }, [
      { type: 'video', selected: true, codec: 'h264', codecProfile: 'High 10' },
    ])).toMatchObject({ ok: false, error: expect.stringContaining('10-bit H.264') })
    expect(castSourceDecision({ url: 'https://cdn.example/e.mp4' }, [
      { type: 'audio', selected: true, codec: 'dts' },
    ])).toMatchObject({ ok: false, error: expect.stringContaining('dts') })
  })

  it('warns about selected ASS subtitles without blocking compatible video', () => {
    expect(castSourceDecision({ url: 'https://cdn.example/e.mp4' }, [
      { type: 'sub', selected: true, codec: 'ass' },
    ])).toMatchObject({ ok: true, warnings: [expect.stringContaining('ASS')] })
  })

  it('recognizes text formats the relay can expose to Cast', () => {
    expect(castSubtitleFormat('https://subs.example/en.vtt?token=x')).toBe('vtt')
    expect(castSubtitleFormat('https://subs.example/en.srt')).toBe('srt')
    expect(castSubtitleFormat('https://subs.example/en.ass')).toBeNull()
  })
})
