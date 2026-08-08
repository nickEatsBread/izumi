import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The mobile hero used to lay the poster and title ON TOP of the banner with a 10%-to-55% gradient,
// so legibility depended on how busy that particular banner was. The artwork is now a band that
// ends in a hard cut, with every piece of text below it on solid background.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')

describe('mobile series hero', () => {
  it('takes the full canvas while mounted and gives it back on teardown', () => {
    expect(detail).toContain("document.documentElement.classList.add('edge-to-edge')")
    expect(detail).toContain("document.documentElement.classList.remove('edge-to-edge')")
  })

  it('renders the artwork as a measured band, not a backdrop behind the text', () => {
    expect(detail).toContain('bind:clientHeight={artHeight}')
    expect(detail).toContain('hero-art')
    // The old text-over-art rescue must be gone.
    expect(detail).not.toContain('drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]')
  })

  it('drives the floating bar from the tested helper', () => {
    expect(detail).toContain("import { heroBarState } from './hero-bar'")
    expect(detail).toContain('heroBarState(scrollY, artHeight, barHeight, barSolid)')
  })

  it('keeps the floating bar clear of the status bar itself', () => {
    // A fixed bar does not inherit main's inset once it locks to the viewport.
    expect(detail).toContain('padding-top:max(0.5rem,env(safe-area-inset-top))')
  })

  it('always offers a back control that cannot trap a deep link', () => {
    expect(detail).toContain('function heroBack()')
    expect(detail).toContain('history.length > 1')
    expect(detail).toContain("goto('/app/home')")
  })
})
