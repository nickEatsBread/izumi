import { describe, expect, it } from 'vitest'
import { applyPlayerCommand, assToVtt, assTimeToVtt, bufferedEnd, clampSeekTime, drmTextType, holdPlaybackDuration, isSolidBlackImageData, mapScreenshotCrop, mpvColorToCss, nearestBifFrame, parseBif, parseStreamDrm, playbackDuration, playerProperty, stripAssTags, videoShotRect, type DrmMedia } from './drm'

function media(init: Partial<DrmMedia> = {}): DrmMedia {
  const state: DrmMedia = {
    currentTime: 10,
    duration: 100,
    paused: false,
    muted: false,
    volume: 1,
    playbackRate: 1,
    play() { state.paused = false },
    pause() { state.paused = true },
    ...init,
  }
  return state
}

describe('parseStreamDrm', () => {
  it('accepts a generic Widevine license endpoint', () => {
    expect(parseStreamDrm({
      keySystem: 'com.widevine.alpha',
      licenseUrl: 'http://127.0.0.1:17871/v/abc/license',
      releaseUrl: 'http://127.0.0.1:17871/v/abc/session',
      videoRobustness: 'SW_SECURE_CRYPTO',
    })).toEqual({
      keySystem: 'com.widevine.alpha',
      licenseUrl: 'http://127.0.0.1:17871/v/abc/license',
      releaseUrl: 'http://127.0.0.1:17871/v/abc/session',
      refreshUrl: undefined,
      licenseHeaders: undefined,
      serverCertificateUrl: undefined,
      videoRobustness: 'SW_SECURE_CRYPTO',
      audioRobustness: undefined,
    })
  })

  it('rejects a source with no license URL', () => {
    expect(parseStreamDrm({ keySystem: 'com.widevine.alpha' })).toBeUndefined()
    expect(parseStreamDrm(null)).toBeUndefined()
  })

  it('defaults the key system when the provider omitted it', () => {
    expect(parseStreamDrm({ licenseUrl: 'http://127.0.0.1/license' })?.keySystem)
      .toBe('com.widevine.alpha')
    expect(parseStreamDrm({ licenseUrl: 'http://127.0.0.1/license' })?.releaseUrl)
      .toBeUndefined()
  })
})

describe('mpvColorToCss', () => {
  it('moves mpv alpha from the front to CSS alpha at the end', () => {
    expect(mpvColorToCss('#ff12aBcD')).toBe('#12abcdff')
    expect(mpvColorToCss('#80112233')).toBe('#11223380')
  })
})

describe('applyPlayerCommand', () => {
  it('toggles pause and mute', () => {
    const m = media({ paused: false })
    applyPlayerCommand(m, 'cycle', ['pause'])
    expect(m.paused).toBe(true)
    applyPlayerCommand(m, 'set', ['pause', 'no'])
    expect(m.paused).toBe(false)
    applyPlayerCommand(m, 'cycle', ['mute'])
    expect(m.muted).toBe(true)
  })

  it('maps mpv volume (0-100) onto HTMLMediaElement volume (0-1)', () => {
    const m = media({ volume: 1 })
    applyPlayerCommand(m, 'set', ['volume', '50'])
    expect(m.volume).toBe(0.5)
    applyPlayerCommand(m, 'add', ['volume', '10'])
    expect(m.volume).toBeCloseTo(0.6)
    expect(playerProperty(m, 'volume')).toBe('60')
    applyPlayerCommand(m, 'add', ['speed', '0.25'])
    expect(m.playbackRate).toBeCloseTo(1.25)
  })

  it('seeks absolute and relative', () => {
    const m = media({ currentTime: 10 })
    applyPlayerCommand(m, 'seek', ['42.5', 'absolute+exact'])
    expect(m.currentTime).toBe(42.5)
    applyPlayerCommand(m, 'seek', ['-2', 'relative+exact'])
    expect(m.currentTime).toBe(40.5)
  })
})

describe('isSolidBlackImageData', () => {
  it('treats a uniform black RGBA buffer as empty capture', () => {
    expect(isSolidBlackImageData(new Uint8ClampedArray(64 * 64 * 4))).toBe(true)
  })

  it('does not reject a frame that has any bright pixel', () => {
    const data = new Uint8ClampedArray(64 * 64 * 4)
    data[0] = 40
    data[1] = 40
    data[2] = 40
    expect(isSolidBlackImageData(data)).toBe(false)
  })
})

describe('mapScreenshotCrop', () => {
  it('maps a CSS video box onto a device-pixel PNG, treating extra height as a titlebar', () => {
    const crop = mapScreenshotCrop(1920, 1128, 1280, 720, { x: 56, y: 0, width: 1224, height: 720 })
    expect(crop.sx).toBeCloseTo(84)
    expect(crop.sy).toBeCloseTo(48)
    expect(crop.sw).toBeCloseTo(1836)
    expect(crop.sh).toBeCloseTo(1080)
  })
})

describe('videoShotRect', () => {
  it('crops letterbox for object-fit contain', () => {
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 1920, height: 1200, top: 0, left: 0, bottom: 1200, right: 1920, toJSON() {} }) as DOMRect,
    }
    const box = videoShotRect(video, 'contain')
    expect(box.width).toBeCloseTo(1920)
    expect(box.height).toBeCloseTo(1080)
    expect(box.y).toBeCloseTo(60)
  })
})

describe('parseBif', () => {
  it('reads timestamped JPEG offsets from a Roku/Fire TV BIF', () => {
    const buf = new Uint8Array(120)
    buf[0] = 0x89; buf[1] = 0x42; buf[2] = 0x49; buf[3] = 0x46
    const view = new DataView(buf.buffer)
    view.setUint32(12, 2, true)
    view.setUint32(16, 1000, true)
    view.setUint32(64, 0, true)
    view.setUint32(68, 88, true)
    view.setUint32(72, 10, true)
    view.setUint32(76, 100, true)
    view.setUint32(80, 0xFFFFFFFF, true)
    view.setUint32(84, 120, true)
    const frames = parseBif(buf)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ time: 0, start: 88, end: 100 })
    expect(frames[1]).toMatchObject({ time: 10, start: 100, end: 120 })
    expect(nearestBifFrame(frames, 9)?.time).toBe(10)
    expect(nearestBifFrame(frames, 0)?.time).toBe(0)
  })
})

describe('playbackDuration', () => {
  it('uses Shaka seekRange when HTML duration is missing or infinite', () => {
    expect(playbackDuration({ duration: Infinity }, { start: 0, end: 1420 })).toBe(1420)
    expect(playbackDuration({ duration: NaN }, { start: 10, end: 90 })).toBe(80)
    expect(playbackDuration({ duration: 24 }, { start: 0, end: 1420 })).toBe(24)
  })
})

describe('holdPlaybackDuration', () => {
  it('keeps the last duration while Shaka is switching presentations', () => {
    expect(holdPlaybackDuration(0, 1420, true)).toBe(1420)
    expect(holdPlaybackDuration(1420.4, 0, true)).toBe(1420.4)
  })

  it('still reports 0 before any duration is known', () => {
    expect(holdPlaybackDuration(0, 0, true)).toBe(0)
    expect(holdPlaybackDuration(0, 1420, false)).toBe(0)
  })
})

describe('clampSeekTime', () => {
  it('keeps a skip inside the seekable window', () => {
    expect(clampSeekTime(50, 0, { start: 0, end: 100 })).toBe(50)
    expect(clampSeekTime(-4, 100)).toBe(0)
    expect(clampSeekTime(999, 100)).toBe(100)
  })
})

describe('bufferedEnd', () => {
  it('returns the end of the range that covers the playhead', () => {
    const buffered = {
      length: 2,
      start: (i: number) => (i === 0 ? 0 : 40),
      end: (i: number) => (i === 0 ? 12 : 55),
    } as TimeRanges
    expect(bufferedEnd({ buffered, currentTime: 8 })).toBe(12)
    expect(bufferedEnd({ buffered, currentTime: 42 })).toBe(55)
  })
})

describe('drmTextType', () => {
  it('keeps closed captions distinct from dialogue subtitles', () => {
    expect(drmTextType('subtitles')).toBe('sub')
    expect(drmTextType('captions')).toBe('caption')
    expect(drmTextType('caption')).toBe('caption')
    expect(drmTextType(undefined)).toBe('sub')
  })
})

describe('assToVtt', () => {
  it('converts ASS clocks and dialogue text', () => {
    expect(assTimeToVtt('0:01:02.03')).toBe('00:01:02.030')
    expect(stripAssTags('{\\i1}Hello\\Nworld')).toBe('Hello\nworld')
    const vtt = assToVtt([
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an8}Hello, world',
    ].join('\n'))
    expect(vtt).toContain('WEBVTT')
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000')
    expect(vtt).toContain('Hello, world')
  })
})
