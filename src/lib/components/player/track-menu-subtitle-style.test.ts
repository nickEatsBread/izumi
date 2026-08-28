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

describe('Unified player media menu', () => {
  it('uses the captions control and removes the standalone server button', () => {
    expect(controls).toContain('aria-label="Audio, subtitles and server"><Captions')
    expect(controls).not.toContain('aria-label="Switch server"')
    expect(controls).not.toContain('showServers')
  })

  it('shows labelled Audio, Subtitles, and Server roots with distinct icons', () => {
    expect(controls).toContain("openDetail('audio')")
    expect(controls).toContain('<Volume2 size={18}')
    expect(controls).toContain("openDetail('subs')")
    expect(controls).toContain('<Captions size={18}')
    expect(controls).toContain("openDetail('server')")
    expect(controls).toContain('<ServerIcon size={18}')
  })

  it('offers the current server and alternatives in the controller menu', () => {
    expect(src).toContain("{ key: 'server' as const, label: 'Server' }")
    expect(src).toContain("kind: 'server' as const")
    expect(src).toContain('serverMenuLabels')
    expect(src).toContain('await playStream(')
  })
})
