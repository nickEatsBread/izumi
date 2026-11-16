import { describe, expect, it } from 'vitest'
import { mergeNativeTracks, usesNativeDrm, type NativeDrmSession } from './native-drm'

function session(overrides: Partial<NativeDrmSession> = {}): NativeDrmSession {
  return {
    thumbnail: async () => null,
    switchTracks: () => [],
    ownsAudioMenu: () => false,
    select: () => false,
    quality: () => ({ mode: 'auto', activeHeight: 1080, heights: [1080, 720] }),
    setQuality: () => {},
    ...overrides,
  }
}

describe('native protected playback', () => {
  it('takes Widevine streams with a licence URL, only where the native player supports them', () => {
    const drm = { keySystem: 'com.widevine.alpha', licenseUrl: 'http://127.0.0.1/v/a/license' }
    expect(usesNativeDrm(drm, true)).toBe(true)
    expect(usesNativeDrm(drm, false)).toBe(false)
    expect(usesNativeDrm({ ...drm, keySystem: 'com.microsoft.playready' }, true)).toBe(false)
    expect(usesNativeDrm({ keySystem: 'com.widevine.alpha' }, true)).toBe(false)
    expect(usesNativeDrm(null, true)).toBe(false)
  })

  it('lists presentation choices instead of the single audio track mpv sees', () => {
    const mpv = JSON.stringify([
      { id: 1, type: 'video', selected: true },
      { id: 1, type: 'audio', lang: 'ja', selected: true },
      { id: 1, type: 'sub', lang: 'eng', selected: true },
    ])
    const merged = JSON.parse(mergeNativeTracks(mpv, session({
      ownsAudioMenu: () => true,
      switchTracks: () => [
        { id: 20_000, type: 'audio', lang: 'ja-JP', selected: true },
        { id: 20_001, type: 'audio', lang: 'en-US', selected: false },
      ],
    })))
    expect(merged.filter((t: { type: string }) => t.type === 'audio').map((t: { id: number }) => t.id)).toEqual([20_000, 20_001])
    expect(merged.find((t: { type: string }) => t.type === 'sub')).toMatchObject({ id: 1, selected: true })
  })

  it('shows a burned-in presentation as the selected subtitle', () => {
    const mpv = JSON.stringify([{ id: 1, type: 'sub', lang: 'eng', selected: true }])
    const merged = JSON.parse(mergeNativeTracks(mpv, session({
      switchTracks: () => [{ id: 21_000, type: 'sub', lang: 'en-US', title: 'English (burned in)', selected: true }],
    })))
    expect(merged.filter((t: { selected?: boolean }) => t.selected).map((t: { id: number }) => t.id)).toEqual([21_000])
  })

  it('keeps mpv tracks when the menu has no presentations to offer', () => {
    const mpv = JSON.stringify([{ id: 1, type: 'audio' }, { id: 2, type: 'audio' }])
    expect(JSON.parse(mergeNativeTracks(mpv, session()))).toHaveLength(2)
    expect(JSON.parse(mergeNativeTracks('not json', session()))).toEqual([])
  })
})
