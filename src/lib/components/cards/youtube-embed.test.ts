import { describe, expect, it } from 'vitest'
import { directYoutubeEmbedUrl, youtubeEmbedNeedsBridge } from './youtube-embed'

describe('YouTube WebView embed routing', () => {
  it('uses the native loopback bridge for Tauri custom-protocol pages', () => {
    expect(youtubeEmbedNeedsBridge('tauri:')).toBe(true)
    expect(youtubeEmbedNeedsBridge('http:')).toBe(false)
    expect(youtubeEmbedNeedsBridge('https:')).toBe(false)
  })

  it('identifies ordinary HTTP embedders to the IFrame Player API', () => {
    const url = new URL(directYoutubeEmbedUrl(
      'M7lc1UVf-VE',
      { controls: false, muted: true },
      'http://tauri.localhost',
    ))
    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.searchParams.get('origin')).toBe('http://tauri.localhost')
    expect(url.searchParams.get('autoplay')).toBe('1')
    expect(url.searchParams.get('mute')).toBe('1')
  })
})
