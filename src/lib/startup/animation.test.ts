import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { playsAtLaunch, STARTUP_COVER_CLASS, STARTUP_ENABLED_KEY, STARTUP_INFO_KEY, STARTUP_PLAYED_KEY } from './animation'

const info = { mime: 'video/mp4', bytes: 10, sha256: 'a'.repeat(64), by: 'pack:a' }

describe('startup animation', () => {
  it('plays at launch only when set, on, motion allowed and not yet played this session', () => {
    const base = { info, enabled: true, reducedMotion: false, playedThisSession: false }
    expect(playsAtLaunch(base)).toBe(true)
    expect(playsAtLaunch({ ...base, info: null })).toBe(false)
    expect(playsAtLaunch({ ...base, enabled: false })).toBe(false)
    expect(playsAtLaunch({ ...base, reducedMotion: true })).toBe(false)
    expect(playsAtLaunch({ ...base, playedThisSession: true })).toBe(false)
  })

  it('app.html paints its cover from the same storage keys the app writes', () => {
    const html = readFileSync('src/app.html', 'utf8')
    for (const key of [STARTUP_INFO_KEY, STARTUP_ENABLED_KEY, STARTUP_PLAYED_KEY, STARTUP_COVER_CLASS]) {
      expect(html).toContain(key)
    }
  })

  // The window appears once WebKit has finished loading, and a video in the page keeps it loading.
  it('loads the video only once the window is on screen', () => {
    const html = readFileSync('src/app.html', 'utf8')
    expect(html).toContain("if (begun || document.readyState !== 'complete' || document.visibilityState !== 'visible') return")
    const component = readFileSync('src/lib/components/StartupAnimation.svelte', 'utf8')
    expect(component.indexOf("if (document.visibilityState !== 'visible') {")).toBeLessThan(component.indexOf('    src = url'))
  })

  it('covers the launch whenever Rust names the video, even with no cached info', () => {
    expect(readFileSync('src/app.html', 'utf8')).toContain("(window.__IZUMI_STARTUP_URL__ || (info && info !== 'null'))")
  })
})
