import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The mobile hero used to lay the poster and title ON TOP of the banner with a 10%-to-55% gradient,
// so legibility depended on how busy that particular banner was. The artwork is now a band that
// ends in a hard cut, with every piece of text below it on solid background.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')

describe('mobile series hero', () => {
  it('takes the full canvas while mounted and gives it back on teardown', () => {
    expect(detail).toContain("import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'")
    expect(detail).toContain('return acquireEdgeToEdge()')
  })

  it('renders the artwork as a measured band, not a backdrop behind the text', () => {
    expect(detail).toContain('bind:clientHeight={artHeight}')
    // The old text-over-art rescue must be gone.
    expect(detail).not.toContain('drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]')
  })

  it('drives the floating bar from the tested helper', () => {
    expect(detail).toContain("import { heroBarState } from './hero-bar'")
    expect(detail).toContain('heroBarState(window.scrollY, artHeight, barHeight, wasSolid)')
    // A $derived that reads what an $effect writes back is an update loop, not a settled value.
    expect(detail).not.toContain('$derived(heroBarState')
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

  it('keeps the hysteresis latch off the reactive graph', () => {
    // A latch an effect both reads and writes must not be $state, or Svelte resolves the cycle as
    // an update loop. Guard the shape, not just the call.
    expect(detail).toContain('let wasSolid = false')
    expect(detail).toContain('if (next.solid === wasSolid) return')
  })

  it('never crops the cover art or feeds a trailer thumbnail to the band', () => {
    expect(detail).toContain('object-contain')
    // banner() falls back to a YouTube still whose blurred pillarbox is baked into the JPEG.
    expect(detail).toContain('<img src={cover(m)} alt="" class="h-full w-full scale-110 object-cover')
    expect(detail).not.toContain('src={banner(m)}')
  })

  it('fades the artwork in rather than popping it', () => {
    expect(detail).toContain('let artLoaded = $state(false)')
    expect(detail).toContain('transition-opacity duration-500')
  })

  it('shapes the loading skeleton like the hero it is standing in for', () => {
    // Same height classes as the real band, so the page does not re-lay-out when data lands.
    const bands = detail.match(/h-\[26vh\] max-h-72 min-h-44/g) ?? []
    expect(bands.length).toBeGreaterThanOrEqual(2)
  })
})
