import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Up Next opt-in contract', () => {
  it('is disabled by default and offers a cancellable countdown', () => {
    const settings = readFileSync('src/lib/settings/ui.ts', 'utf8')
    const overlay = readFileSync('src/lib/components/player/UpNextOverlay.svelte', 'utf8')
    expect(settings).toContain("persisted<boolean>('player-up-next-overlay', false)")
    expect(overlay).toContain('prompt.play()')
    expect(overlay).toContain('$upNextPrompt.stay')
  })
})
