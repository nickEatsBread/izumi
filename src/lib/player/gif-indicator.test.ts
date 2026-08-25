import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const player = readFileSync('src/lib/components/player/PlayerOverlay.svelte', 'utf8')
const titlebar = readFileSync('src/lib/components/shell/Titlebar.svelte', 'utf8')
const css = readFileSync('src/app.css', 'utf8')

describe('desktop GIF recording indicator', () => {
  it('uses the player indicator in fullscreen and the titlebar indicator while windowed', () => {
    expect(player).toContain('($fullscreen || gmMode) && !$pictureInPicture')
    expect(player).toContain('data-gif-recording-indicator')
    expect(titlebar).toContain('{#if $gifRecordingStart != null}')
    expect(titlebar).toContain('onclick={stopGif}')
    expect(titlebar).not.toContain('data-capture-exclude')
  })

  it('keeps the visible recording indicator out of captured output', () => {
    expect(player).not.toContain('data-gif-recording-indicator data-capture-exclude')
    expect(css).toContain('html.izumi-capture-output .izumi-player-root > :not(.izumi-capture-root)')
  })
})
