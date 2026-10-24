import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const player = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')
const icon = readFileSync(fileURLToPath(new URL('./PlayPauseIcon.svelte', import.meta.url)), 'utf8')

describe('Android transport icon transition', () => {
  it('does not compound the controls fade with a second glyph opacity transition', () => {
    expect(player).not.toContain("import { scale, fade } from 'svelte/transition'")
    expect(player).not.toContain('in:scale={{ duration: 160, start: 0.5 }}')
    expect(player).toContain('<PlayPauseIcon {paused} size={38}')
    // Local transitions: the crossfade runs on a toggle, not when the controls mount.
    expect(icon).not.toContain('|global')
  })

  it('crossfades play/pause like the reference player, honouring reduced motion', () => {
    expect(icon).toContain('{#key paused}')
    expect(icon).toContain('in:motion={fade} out:motion={fade}')
    expect(icon).toContain('opacity: [0, 1], duration: 150')
  })
})
