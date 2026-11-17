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

  // Shaka's active variant is the one being fetched; the buffered rung plays for up to 30 s after a switch.
  it('reports the height on screen, again whenever it changes', () => {
    expect(surface).toMatch(/const activeHeight = videoEl\?\.videoHeight\s*\|\| Number\(available\.find/)
    expect(surface).toContain('onresize={() => emitQualityInfo()}')
  })

  it('holds a picked height for every load, so a presentation switch reloads onto it', () => {
    expect(surface).toMatch(/function applyAbrPolicy\(\) \{\s*if \(!player\) return\s*setAbrEnabled\(qualityMode === 'auto'\)\s*setAbrHeights\(abrHeightRange\(qualityMode, firstFrame\)\)/)
    expect(surface).not.toMatch(/setAbrEnabled\(false\)\s*if \(!best\.active\)/)
  })

  it('starts Linux protected playback on the preference too', () => {
    const native = readFileSync(new URL('./NativeDrmSurface.svelte', import.meta.url), 'utf8')
    expect(native).toMatch(/const preferred = Number\(get\(preferredQuality\)\)\s*qualityMode = Number\.isFinite\(preferred\) && preferred > 0 \? preferred : 'auto'/)
    expect(native).toContain("maxHeight: qualityMode === 'auto' ? undefined : qualityMode")
    expect(native).toContain('if (qualityMode !== \'auto\') qualityMode = preferredDrmQuality(String(qualityMode), heights)')
  })
})
