import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The mobile hero used to lay the poster and title ON TOP of the banner with a 10%-to-55% gradient,
// so legibility depended on how busy that particular banner was. The artwork is now a band that
// ends in a hard cut, with every piece of text below it on solid background.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const hero = readFileSync(fileURLToPath(new URL('../banner/Hero.svelte', import.meta.url)), 'utf8')

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
    // Desktop and Deck use the same compact hero variants and overlap as the loaded branch.
    expect(detail).toContain("$gameMode ? 'sm:h-[42vh]' : 'sm:h-[48vh]'")
    expect(hero).toContain('h-[40vh]')
    expect(hero).toContain("$gameMode ? 'sm:h-[42vh]' : 'sm:h-[48vh]'")
    expect(detail.match(/\$gameMode \? '-mt-\[16vh\]' : '-mt-\[18vh\]'/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('carries known titles into loading without a fake alternate-title shimmer', () => {
    expect(detail).not.toContain('Loading title…')
    expect(detail.match(/detailHint\?\.title\.native \|\| detailHint\?\.title\.romaji/g)?.length).toBe(2)
    expect(detail).not.toContain('h-4 w-40 rounded skeloader')
  })

  it('does not let the portrait cover create a dead zone before episodes', () => {
    // The desktop cover used to grow to 13rem at md, leaving the tabs beneath its height even when
    // the adjacent title/description/actions ended much earlier. Loading and loaded layouts must
    // share the balanced 11rem identity-cover geometry.
    expect(detail).not.toContain('md:w-52')
    expect(detail.match(/h-auto w-44 shrink-0 self-start rounded-lg/g)?.length).toBeGreaterThanOrEqual(2)
    expect(detail).toContain('class="mb-4 flex flex-col gap-5 md:flex-row"')
  })
  it('keeps the poster above the artwork band', () => {
    // The band is positioned, so it paints over static in-flow content - and the poster row is
    // pulled up into it. Without its own stacking context the band covered the poster's top the
    // moment its image loaded, which read as the cover being cropped.
    expect(detail).toContain('relative z-10 -mt-10 flex gap-4')
  })

  it('keeps a quiet borderless schedule summary beneath mobile facts', () => {
    expect(detail).toContain('mt-3 flex flex-wrap items-center gap-2 empty:mt-0')
    expect(detail).toContain('<AiringStatus media={m} />')
    const airing = readFileSync(fileURLToPath(new URL('./AiringStatus.svelte', import.meta.url)), 'utf8')
    expect(airing).toContain('gap-x-2 whitespace-nowrap text-xs text-muted-foreground')
    expect(airing).toContain("toolbar ? 'h-9' : ''")
    expect(airing).not.toContain('compact = false')
    expect(airing).not.toContain('quiet = false')
  })

  it('surfaces a complete, discoverable mobile anime overview without crowding the hero', () => {
    expect(detail).toContain("['Episodes', 'Overview', 'Relations', 'Characters', 'Recommended']")
    expect(detail).toContain('aria-label="Genres"')
    expect(detail).toContain('From {prettyEnum(m.source)}')
    expect(detail).toContain('{m.duration} min')
    expect(detail).toContain("{:else if active === 'Overview'}")
    for (const heading of ['Synopsis', 'Information', 'Studio', 'Runtime', 'Source', 'Country', 'Popularity', 'Themes', 'Alternative titles']) {
      expect(detail).toContain(`>${heading}<`)
    }
  })
})

describe('series airing schedule', () => {
  it('renders SUB and DUB as distinct colored words in one quiet schedule line', () => {
    const airing = readFileSync(fileURLToPath(new URL('./AiringStatus.svelte', import.meta.url)), 'utf8')
    expect(airing).toContain("kind === 'Dub'")
    expect(airing).toContain('text-violet-300')
    expect(airing).toContain('text-sky-300')
    expect(airing).toContain('{#if index}<span class="opacity-40"')
    expect(airing).toContain('tabular-nums')
    expect(airing).not.toContain('ring-violet')
    expect(airing).not.toContain('border-l border-border')
  })
})
