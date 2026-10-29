import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { preferredDrmQuality } from './drm-quality'

const surface = readFileSync(new URL('./DrmSurface.svelte', import.meta.url), 'utf8')

describe('protected playback start quality', () => {
  it('starts on the tallest offered height at or below the preference, else Auto', () => {
    expect(preferredDrmQuality('1080', [1080, 720, 480])).toBe(1080)
    expect(preferredDrmQuality('2160', [720, 1080])).toBe(1080)
    expect(preferredDrmQuality('720', [1080, 480])).toBe(480)
    expect(preferredDrmQuality('480', [1080, 720])).toBe('auto')
    expect(preferredDrmQuality('any', [1080, 720])).toBe('auto')
    expect(preferredDrmQuality('1080', [])).toBe('auto')
  })

  it('applies the preference once per load, and a menu pick keeps winning', () => {
    expect(surface).toMatch(/if \(gen === loadGen && !qualityPicked\) \{\s*const start = preferredDrmQuality\(get\(preferredQuality\), qualityInfo\(\)\.heights\)/)
    expect(surface).toMatch(/qualityMode = 'auto'\s*qualityPicked = false/)
    expect(surface.match(/qualityPicked = true/g)).toHaveLength(2)
  })
})
