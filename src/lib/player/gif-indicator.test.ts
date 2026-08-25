import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { usePlayerGifRecordingIndicator } from './gif-indicator'

const player = readFileSync('src/lib/components/player/PlayerOverlay.svelte', 'utf8')
const titlebar = readFileSync('src/lib/components/shell/Titlebar.svelte', 'utf8')
const css = readFileSync('src/app.css', 'utf8')

describe('desktop GIF recording indicator', () => {
  it('uses the player indicator in fullscreen while retaining the titlebar variant', () => {
    expect(usePlayerGifRecordingIndicator).toBe(true)
    expect(player).toContain('usePlayerGifRecordingIndicator && ($fullscreen || gmMode)')
    expect(player).toContain('data-gif-recording-indicator')
    expect(titlebar).toContain('!usePlayerGifRecordingIndicator && $gifRecordingStart != null')
    expect(titlebar).toContain('onclick={stopGif}')
  })

  it('keeps the visible recording indicator out of captured output', () => {
    expect(player).not.toContain('data-gif-recording-indicator data-capture-exclude')
    expect(css).toContain('html.izumi-capture-output .izumi-player-root > :not(.izumi-capture-root)')
  })
})
