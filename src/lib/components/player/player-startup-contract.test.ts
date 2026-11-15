import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const overlay = readFileSync(fileURLToPath(new URL('./PlayerOverlay.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// Starting an episode showed a title bar and buttons over black until the picture came: a broken-
// looking player. The controls first show with the picture, unless the viewer asks for them.
describe('player startup', () => {
  it('keeps the controls away until the first frame, then shows them once', () => {
    expect(overlay).toContain('let visible = $state(false)')
    expect(overlay).toContain('visible || (firstFrame && !quietPadSeek && ((transportPaused && !pausedIdle) || loading || $scrubActive))')
    expect(overlay).toContain('$effect(() => { if (firstFrame) untrack(poke) })')
  })

  it('shows them for a pointer that moved, not for the page changing under a parked cursor', () => {
    // WebKit sends a mousemove when the player appears under the Deck's hidden cursor.
    expect(overlay).toContain('<svelte:window onmousemove={onPointerMove}')
    expect(overlay).toContain('const moved = !!lastPointer && at !== lastPointer')
  })

  it('shows the connecting screen\'s ring for every playback wait, Game mode included', () => {
    const live = overlay.slice(overlay.indexOf('{#if loading}'))
    expect(live.slice(0, live.indexOf('{/if}'))).toContain('<Spinner size="player" />')
  })
})
