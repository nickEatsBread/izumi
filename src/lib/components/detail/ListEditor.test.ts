import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./ListEditor.svelte', import.meta.url)), 'utf8')
const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const select = readFileSync(fileURLToPath(new URL('../settings/SelectMenu.svelte', import.meta.url)), 'utf8')
const scale = readFileSync(fileURLToPath(new URL('./ScoreScale.svelte', import.meta.url)), 'utf8')

describe('mobile list editor layout', () => {
  it('uses the dynamic viewport and keeps fields in a separate scrolling region', () => {
    expect(source).toContain('h-[100dvh]')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('keeps the save actions outside the scroll area and above Android system UI', () => {
    expect(source).toContain('flex shrink-0 items-center gap-2 border-t')
    expect(source).toContain('env(safe-area-inset-bottom)')
  })

  it('slides the sheet up over a fading scrim instead of appearing', () => {
    expect(source).toContain('in:fly={{ y: 48, duration: 260')
    expect(source).toContain('transition:fade={{ duration: 180 }}')
  })
})

describe('desktop list editor popover', () => {
  it('anchors to the button that opened it and scales in from that corner', () => {
    expect(detail).toContain('bind:this={editorAnchor}')
    expect(detail).toContain('anchor={editorAnchor}')
    expect(source).toContain('const popover = $derived(!!anchor && !$isMobile)')
    expect(source).toContain('in:scale={{ start: 0.96, duration: 160')
    expect(source).toContain('transform-origin:{place.origin}')
  })

  it('is non-modal: no scrim, a click anywhere else dismisses, the anchor never re-flashes it', () => {
    expect(source).toContain('class="fixed inset-0 z-50 pointer-events-none"')
    expect(source).toContain("window.addEventListener('pointerdown', outside, true)")
    expect(source).toContain('panel?.contains(target) || anchor?.contains(target)')
  })

  it('flips above the anchor when there is more room there', () => {
    expect(source).toContain("const down = below >= height || below >= above")
    expect(source).toContain("origin: down ? 'top left' : 'bottom left'")
  })
})

describe('score control', () => {
  it('picks from the shared labelled 0-10 rating scale, not a −/+ stepper', () => {
    expect(source).toContain('<ScoreScale value={score10} onpick={(n) => (score10 = n)} label="Score" compact />')
    // The scale follows the viewer's rating style; its dropdown style keeps every descriptor.
    expect(scale).toContain("{ value: '0', label: '–', description: 'Not rated' }")
    expect(scale).toContain('{ value: String(n), label: String(n), description: descriptor }')
    expect(source).not.toContain('changeScore(')
    expect(source).not.toContain('aria-label="Increase score"')
  })

  it('floats its menu so the dialog body cannot clip it, and Escape closes only the menu', () => {
    expect(source).toContain('floating')
    expect(select).toContain('{:else if floating}')
    expect(select).toContain('event.stopPropagation()')
  })

  it('keeps the episode stepper (a count is a stepper; a rating is a choice)', () => {
    expect(source).toContain('aria-label="Increase episodes watched"')
    expect(source).toContain('class="progress-input')
  })
})
