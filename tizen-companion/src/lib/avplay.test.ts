import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvPlayController } from './avplay'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('AVPlay setup', () => {
  it('configures adaptive playback while IDLE and starts after prepare', async () => {
    const calls: string[] = []
    const player = {
      open: vi.fn(() => calls.push('open')),
      close: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(() => 'READY'),
      setListener: vi.fn(),
      setDisplayRect: vi.fn(),
      setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(() => calls.push('buffer')),
      setStreamingProperty: vi.fn((name: string) => calls.push(name)),
      getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void) => { calls.push('prepare'); success() }),
      play: vi.fn(() => calls.push('play')),
      pause: vi.fn(),
      seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000),
      getCurrentTime: vi.fn(() => 0),
      getTotalTrackInfo: vi.fn(() => []),
      setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player } } })
    const controller = new AvPlayController()
    await controller.load({
      sessionId: 'session',
      url: 'https://example.test/master.m3u8',
      title: 'Test',
      contentType: 'application/vnd.apple.mpegurl',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    }, {
      onBuffering: vi.fn(),
      onState: vi.fn(),
      onTime: vi.fn(),
      onTracks: vi.fn(),
      onSubtitle: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    })

    expect(player.setStreamingProperty).toHaveBeenCalledWith('ADAPTIVE_INFO', 'STARTBITRATE=AVERAGE')
    expect(calls.indexOf('buffer')).toBeLessThan(calls.indexOf('prepare'))
    expect(calls.indexOf('prepare')).toBeLessThan(calls.indexOf('play'))
  })

  it('retries one failed prepare without dropping the session', async () => {
    let attempts = 0
    const player = {
      open: vi.fn(), close: vi.fn(), stop: vi.fn(), getState: vi.fn(() => 'READY'),
      setListener: vi.fn(), setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
      setBufferingParam: vi.fn(), setStreamingProperty: vi.fn(), getStreamingProperty: vi.fn(() => 'false'),
      prepareAsync: vi.fn((success: () => void, failure: (error: unknown) => void) => {
        attempts += 1
        if (attempts === 1) failure(new Error('temporary network error'))
        else success()
      }),
      play: vi.fn(), pause: vi.fn(), seekTo: vi.fn((_position: number, success: () => void) => success()),
      getDuration: vi.fn(() => 60_000), getCurrentTime: vi.fn(() => 0), getTotalTrackInfo: vi.fn(() => []),
      setSelectTrack: vi.fn(),
    }
    Object.assign(globalThis, { window: { webapis: { avplay: player }, setTimeout } })
    const controller = new AvPlayController()
    await controller.load({ sessionId: 'retry', url: 'https://example.test/video.mp4', title: 'Retry', positionSeconds: 0, subtitles: [], activeTrackIds: [] }, {
      onBuffering: vi.fn(), onState: vi.fn(), onTime: vi.fn(), onTracks: vi.fn(), onSubtitle: vi.fn(), onComplete: vi.fn(), onError: vi.fn(),
    })
    expect(player.open).toHaveBeenCalledTimes(2)
    expect(player.play).toHaveBeenCalledTimes(1)
  })
})
