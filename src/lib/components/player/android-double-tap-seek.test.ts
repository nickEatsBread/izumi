import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const player = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')

describe('Android double-tap seek', () => {
  it('hides controls for the full accumulating seek sequence', () => {
    const bumpSeek = player.slice(player.indexOf('function bumpSeek'), player.indexOf('function onTap'))
    expect(bumpSeek).toContain('clearTimeout(hideTimer)')
    expect(bumpSeek).toContain('controlsShown = false')
  })
})
