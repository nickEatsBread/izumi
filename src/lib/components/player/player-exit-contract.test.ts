import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const overlay = readFileSync(fileURLToPath(new URL('./PlayerOverlay.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// B took ~0.85 s to show the page on the Steam Deck while the episode kept playing, sometimes with
// the controls up, so it read as the press being ignored.
describe('closing the player', () => {
  it('stops the picture at the press, before the page comes back', () => {
    const start = overlay.slice(overlay.indexOf('async function close()'), overlay.indexOf('await exitFullscreen()'))
    expect(start).toContain('exiting = true')
    expect(start).toContain("void invoke('player_command', { name: 'set', args: ['pause', 'yes'] }).catch(() => {})")
  })

  it('brings no controls up for that pause', () => {
    expect(overlay).toContain('const controlsVisible = $derived(!exiting && (')
  })
})
