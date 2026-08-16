import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const player = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')

describe('Android transport icon transition', () => {
  it('does not compound the controls fade with a second glyph opacity transition', () => {
    expect(player).not.toContain("import { scale, fade } from 'svelte/transition'")
    expect(player).not.toContain('in:scale={{ duration: 160, start: 0.5 }}')
    expect(player).toContain('class="transport-glyph grid place-items-center"')
  })

  it('keeps the play/pause morph as a transform-only animation', () => {
    const animation = player.match(/@keyframes transport-glyph-pop \{([^}]+\}[^}]*)\}/)?.[1] ?? ''

    expect(animation).toContain('transform: scale(0.5)')
    expect(animation).toContain('transform: scale(1)')
    expect(animation).not.toContain('opacity')
  })
})
