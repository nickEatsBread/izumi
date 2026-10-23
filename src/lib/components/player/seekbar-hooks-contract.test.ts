import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const seekbar = readFileSync(fileURLToPath(new URL('./Seekbar.svelte', import.meta.url)), 'utf8')

describe('seek bar styling hooks', () => {
  it('marks the track, buffer, fill and preview', () => {
    for (const part of ['track', 'buffer', 'fill', 'preview']) expect(seekbar).toContain(`data-part="player.seekbar.${part}"`)
  })

  it('draws a knob on desktop as well as in Game mode', () => {
    expect(seekbar.split('data-part="player.seekbar.knob"').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('moves the desktop knob with a drag and marks it', () => {
    expect(seekbar).toContain('data-scrubbing={seeking || undefined}')
    expect(seekbar).toContain('style:left="{seeking ? hoverPct : progressPct}%"')
  })

  it('keeps the root findable and hideable for the native player', () => {
    expect(seekbar).toContain('aria-label="Seek"')
    expect(seekbar).toContain('class:opacity-0={native}')
  })
})
