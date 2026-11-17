import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('player top row', () => {
  it('centres Back on the same line as the P2P readout', () => {
    const controls = read('./Controls.svelte')
    const overlay = read('./P2PStatusOverlay.svelte')
    // Back: 8px top padding + Navigator's 36px circle = centre at 26px.
    expect(controls).toContain("{gm ? 'px-8 py-6' : 'px-4 pb-3 pt-2'}")
    expect(controls).toContain('grid size-9 shrink-0 select-none place-items-center rounded-full bg-[#1a1a1a] text-white')
    // Readout: 12px top padding + a 28px text-lg line = centre at 26px.
    expect(overlay).toContain("'gap-4 pt-3 text-lg'")
  })

  it('keeps Back clickable under the windowed titlebar without losing the window drag', () => {
    const controls = read('./Controls.svelte')
    expect(controls).toContain("const underTitlebar = $derived(!gm && !$fullscreen && !$isMobile && !$isTv && ($shellNav !== 'top' || $playerCoversWindow))")
    expect(controls).toContain('<div data-tauri-drag-region class="pointer-events-auto absolute inset-x-0 top-0 h-8"></div>')
    expect(controls).toContain('class="pointer-events-auto relative grid size-9 shrink-0 select-none')
    expect(controls).toContain('playerTopBarUnderTitlebar.set(true)')
    expect(controls).toContain('return () => playerTopBarUnderTitlebar.set(false)')
  })

  it('fades the window buttons with the controls and never lets a hidden Close take a click', () => {
    const titlebar = read('../shell/Titlebar.svelte')
    const overlay = read('./PlayerOverlay.svelte')
    expect(titlebar).toContain("{$playerChromeVisible ? '' : 'opacity-0 [&_button]:pointer-events-none'}")
    expect(overlay).toContain('playerChromeVisible.set(controlsVisible || docked)')
    expect(overlay).toContain('$effect(() => () => playerChromeVisible.set(true))')
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

  it('never lays the titlebar leading slot over Back as a drag region', () => {
    const titlebar = read('../shell/Titlebar.svelte')
    // Back keeps the bar's 16px edge unless the slot holds something, so the empty slot (56px wide,
    // 32px tall, a drag region) covered the top two thirds of the circle: a click there dragged the
    // window instead. The slot follows the bar's pointer events; the GIF chip inside opts back in.
    const slot = titlebar.match(/<div data-tauri-drag-region class="([^"]*h-8 shrink-0[^"]*)"/)?.[1] ?? ''
    expect(slot).toContain('relative flex h-8 shrink-0')
    expect(slot).not.toContain('pointer-events-auto')
  })
})
