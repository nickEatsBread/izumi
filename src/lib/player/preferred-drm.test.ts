import { describe, expect, it } from 'vitest'
import { downloadAudioLang, offlineManifestUrl, preferredDrmPresentation, selectOfflineTracks, shouldAutoReloadHardsub, waitForCatalog } from './preferred-drm'

const url = 'http://127.0.0.1/v/abc/manifest.mpd'
const englishSidecar = {
  url: 'http://127.0.0.1/v/abc/asset?u=en.ass',
  lang: 'en-US',
  title: 'English',
  kind: 'subtitles' as const,
}
const englishHard = {
  url: 'http://127.0.0.1/v/abc/manifest.mpd?hard=en-US',
  lang: 'en-US',
  kind: 'subtitles' as const,
  switchUrl: 'http://127.0.0.1/v/abc/manifest.mpd?hard=en-US',
}
const audioTracks = [
  { lang: 'ja-JP', switchUrl: 'http://127.0.0.1/v/abc/manifest.mpd?audio=ja-JP' },
  { lang: 'en-US', switchUrl: 'http://127.0.0.1/v/abc/manifest.mpd?audio=en-US' },
]

describe('offlineManifestUrl', () => {
  it('marks a DASH URL as a full store and optional height cap', () => {
    expect(offlineManifestUrl('http://127.0.0.1/v/abc/manifest.mpd')).toContain('offline=1')
    expect(offlineManifestUrl('http://127.0.0.1/v/abc/manifest.mpd', 480)).toContain('height=480')
    expect(offlineManifestUrl('http://127.0.0.1/v/abc/manifest.mpd?audio=en-US', 720)).toContain('audio=en-US')
  })
})

describe('downloadAudioLang', () => {
  it('maps the download dialog onto the player audio preference', () => {
    expect(downloadAudioLang('dub', 'jpn')).toBe('eng')
    expect(downloadAudioLang('sub', 'eng')).toBe('jpn')
    expect(downloadAudioLang('any', 'eng')).toBe('eng')
    expect(downloadAudioLang(undefined, 'jpn')).toBe('jpn')
  })
})

describe('preferredDrmPresentation', () => {
  it('stores the preferred sidecar when the source has soft subs', () => {
    const picked = preferredDrmPresentation({
      url,
      audioLang: 'ja-JP',
      subtitles: [englishSidecar, { ...englishSidecar, lang: 'de-DE', url: 'http://x/de.ass' }],
      preferredAudio: 'jpn',
      preferredSub: 'eng',
    })
    expect(picked.url).toBe(url)
    expect(picked.subtitles).toEqual([englishSidecar])
    expect(picked.audioLang).toBe('ja-JP')
  })

  it('downloads the burned-in manifest when that is the preferred subtitle', () => {
    const picked = preferredDrmPresentation({
      url,
      audioLang: 'ja-JP',
      subtitles: [englishHard],
      preferredAudio: 'jpn',
      preferredSub: 'eng',
    })
    expect(picked.url).toContain('hard=en-US')
    expect(picked.subtitles).toEqual([])
  })

  it('switches to the preferred audio manifest when the source splits dubs', () => {
    const picked = preferredDrmPresentation({
      url,
      audioLang: 'ja-JP',
      audioTracks,
      subtitles: [englishSidecar],
      preferredAudio: 'eng',
      preferredSub: 'eng',
    })
    expect(picked.url).toContain('audio=en-US')
    expect(picked.audioLang).toBe('en-US')
    expect(picked.subtitles).toEqual([])
  })

  it('stores no text when the user turned subtitles off', () => {
    const picked = preferredDrmPresentation({
      url,
      audioLang: 'ja-JP',
      subtitles: [englishSidecar, englishHard],
      preferredAudio: 'jpn',
      preferredSub: 'none',
    })
    expect(picked.url).not.toContain('hard=')
    expect(picked.subtitles).toEqual([])
  })

  it('does not change audio on first playback load', () => {
    const picked = preferredDrmPresentation({
      url,
      audioLang: 'ja-JP',
      audioTracks,
      preferredAudio: 'eng',
      preferredSub: 'none',
      switchAudio: false,
    })
    expect(picked.url).not.toContain('audio=')
    expect(picked.audioLang).toBe('ja-JP')
  })
})

describe('selectOfflineTracks', () => {
  const tracks = [
    { type: 'variant', height: 1080, bandwidth: 5, language: 'ja-JP' },
    { type: 'variant', height: 480, bandwidth: 1, language: 'ja-JP' },
    { type: 'variant', height: 480, bandwidth: 2, language: 'en-US' },
    { type: 'text', language: 'en-US' },
    { type: 'text', language: 'de-DE' },
  ]

  it('keeps one preferred-height audio variant plus preferred text', () => {
    const picked = selectOfflineTracks(tracks, {
      preferredHeight: 480,
      audioLang: 'en-US',
      preferredSubLang: 'eng',
    })
    expect(picked).toEqual([
      { type: 'variant', height: 480, bandwidth: 2, language: 'en-US' },
      { type: 'text', language: 'en-US' },
    ])
  })

  it('drops in-band text when subtitles are off', () => {
    expect(selectOfflineTracks(tracks, { preferredSubLang: 'none' }).filter((track) => track.type === 'text')).toEqual([])
  })
})

describe('shouldAutoReloadHardsub', () => {
  const hard = { preferredId: 10_000, switchIdMin: 10_000 }

  it('never auto-reloads a burned-in MPD after playback has started', () => {
    expect(shouldAutoReloadHardsub({ ...hard, playbackStarted: true })).toBe(false)
    expect(shouldAutoReloadHardsub({ ...hard, playbackStarted: false, skipHardReload: true })).toBe(false)
  })

  it('does not auto-reload even before a frame — the first load already waited for the catalog', () => {
    expect(shouldAutoReloadHardsub({ ...hard, playbackStarted: false })).toBe(false)
  })
})

describe('waitForCatalog', () => {
  it('returns the catalog when it arrives in time', async () => {
    await expect(waitForCatalog(Promise.resolve({ ok: true }), 200)).resolves.toEqual({ ok: true })
  })

  it('gives up so the first Shaka load is not blocked forever', async () => {
    await expect(waitForCatalog(new Promise(() => {}), 20)).resolves.toBeUndefined()
  })
})
