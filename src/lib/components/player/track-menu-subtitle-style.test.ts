import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./TrackMenu.svelte', import.meta.url)), 'utf8')
const controls = readFileSync(fileURLToPath(new URL('./Controls.svelte', import.meta.url)), 'utf8')

describe('Steam Deck subtitle style menu', () => {
  it('offers saved presets and an automatic current-release save action', () => {
    expect(src).toContain("{ key: 'style' as const, label: 'Subtitle style' }")
    expect(src).toContain("kind: 'style-preset'")
    expect(src).toContain("label: 'Save current release style'")
  })

  it('captures ASS fonting and applies the saved preset to the current session', () => {
    expect(src).toContain('captureFromExtradata(raw)')
    expect(src).toContain('saveSubtitlePreset(')
    expect(src).toContain('sessionSubtitleStyle.set(preset)')
    expect(src).toContain('sessionSubtitleStyle.set(leaf.preset)')
  })

  it('also exposes save/apply in the Deck touch fallback menu', () => {
    expect(controls).toContain('async function saveDeckSubtitleStyle()')
    expect(controls).toContain('Save current release style')
    expect(controls).toContain('Apply {preset.name}')
  })
})
