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
    expect(seekbar).toContain('const knobX = $derived((barW * (seeking ? hoverPct : progressPct)) / 100)')
    // After the release the knob holds the target until the reported playhead reaches it.
    expect(seekbar).toContain('const progressPct = $derived(pct(heldT ?? pos))')
    expect(seekbar).toContain('heldT = hoverT')
  })

  it('draws the desktop knob inert, hidden and above the segment marks, moved by the translate property', () => {
    const tag = seekbar.match(/\{#if !gm\}\s*(<span data-part="player\.seekbar\.knob"[^>]*>)/)?.[1] ?? ''
    expect(tag).toContain('aria-hidden="true"')
    for (const cls of ['pointer-events-none', 'opacity-0', 'z-20']) expect((tag.match(/class="([^"]*)"/)?.[1] ?? '').split(' ')).toContain(cls)
    // `translate` applies after `scale` and `transform`, so a theme's hover grow scales the knob in
    // place; with `transform` positioning a `scale` multiplied the playhead offset and moved the knob.
    expect(tag).toContain('translate:calc({knobX}px - 50%) -50%')
    expect(tag).not.toContain('transform:')
    expect(tag).not.toContain('style:left')
  })

  it('keeps the root findable and hideable for the native player', () => {
    expect(seekbar).toContain('aria-label="Seek"')
    expect(seekbar).toContain('class:opacity-0={native}')
  })
})
