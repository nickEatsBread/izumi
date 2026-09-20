import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const card = readFileSync(fileURLToPath(new URL('./EpisodeCard.svelte', import.meta.url)), 'utf8')

describe('episode card thumbnail hover', () => {
  it('keeps the zoom clipped behind an opaque overlapping footer', () => {
    expect(card).toContain('group isolate select-none')
    expect(card).toContain('overflow-hidden')
    expect(card).toContain('relative z-0 aspect-video')
    expect(card).toContain('block h-full w-full object-cover')
    expect(card).toContain('relative z-10 flex min-w-0 items-center gap-2 bg-inherit')
    expect(card).toContain('sm:-mt-px')
    expect(card).toContain("released ? 'group-hover:scale-105' : 'grayscale'")
  })

  it('keeps the shipped card lift and accent fill unless a theme opts into scale hover', () => {
    expect(card).toContain("released && !themeCard && !listRow ? 'transition-transform hover:scale-[1.02] hover:bg-accent'")
    expect(card).toContain("released && hoverScale && !listRow ? 'transition-transform duration-200 hover:z-10 hover:scale-[1.035]'")
  })
})
