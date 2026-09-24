import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('player top row', () => {
  it('centres Back on the same line as the P2P readout', () => {
    const controls = read('./Controls.svelte')
    const overlay = read('./P2PStatusOverlay.svelte')
    // Back: 8px top padding + a 36px pill (py-2 around a 20px row) = centre at 26px.
    expect(controls).toContain("{gm ? 'px-8 py-6' : 'px-4 pb-3 pt-2'}")
    expect(controls).toContain('rounded-full bg-black/60 py-2 pl-2.5 pr-3.5 text-sm font-bold')
    // Readout: 12px top padding + a 28px text-lg line = centre at 26px.
    expect(overlay).toContain("'gap-4 pt-3 text-lg'")
  })

  it('keeps Back clickable under the windowed titlebar without losing the window drag', () => {
    const controls = read('./Controls.svelte')
    expect(controls).toContain("const underTitlebar = $derived(!gm && !$fullscreen && !$isMobile && !$isTv && $shellNav !== 'top')")
    expect(controls).toContain('<div data-tauri-drag-region class="pointer-events-auto absolute inset-x-0 top-0 h-8"></div>')
    expect(controls).toContain('class="pointer-events-auto relative flex shrink-0 select-none items-center')
    expect(controls).toContain('playerTopBarUnderTitlebar.set(true)')
    expect(controls).toContain('return () => playerTopBarUnderTitlebar.set(false)')
  })

  it('yields the titlebar over the video only, keeping its controls and side drag regions live', () => {
    const titlebar = read('../shell/Titlebar.svelte')
    expect(titlebar).toContain('class:pointer-events-none={$playerTopBarUnderTitlebar}')
    expect(titlebar).toContain('style:width="{$playerStage.left * 100}%"')
    expect(titlebar).toContain('style:width="{$playerStage.right * 100}%"')
    // GIF chip, cast chip and the three window buttons all opt back in.
    expect(titlebar.match(/<button[^>]*\n?[^>]*pointer-events-auto/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(titlebar.match(/class="pointer-events-auto grid h-8 w-11/g)).toHaveLength(3)
  })
})
