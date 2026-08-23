import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hero = readFileSync(fileURLToPath(new URL('./Hero.svelte', import.meta.url)), 'utf8')

describe('featured carousel UX', () => {
  it('shows a live next-episode countdown', () => {
    expect(hero).toContain('setInterval(() => (clock = Date.now()), 1_000)')
    expect(hero).toContain('`Episode ${nextAiring.episode} in ${airingCountdown(nextAiringAt, clock)}`')
  })

  it('combines airing context and genres beneath a compact discovery-facts row', () => {
    expect(hero).toContain("current?.studios?.nodes?.[0]?.name || season(current)")
    expect(hero).toContain('{#if nextAiringLabel || current.genres?.length}')
    expect(hero).toContain('{current.averageScore}% score')
    expect(hero).toContain('{totalEpisodes(current)} episodes')
  })

  it('reveals explicit edge navigation and animates in the requested direction', () => {
    expect(hero).toContain('aria-label="Previous featured anime"')
    expect(hero).toContain('aria-label="Next featured anime"')
    expect(hero).toContain('hero-slide-in')
    expect(hero).toContain('--hero-enter-x:{navDirection * 3}%')
  })

  it('keeps a skeleton visible until the active artwork has loaded', () => {
    expect(hero).toContain('const artworkReady = $derived(loadedArtworkId === current?.id)')
    expect(hero.match(/\{#if !artworkReady\}<div class="absolute inset-0 skeloader"><\/div>\{\/if\}/g)?.length).toBe(2)
    expect(hero.match(/onload=\{artworkSettled\} onerror=\{artworkSettled\}/g)?.length).toBe(2)
  })

  it('keeps pointer-only carousel controls out of Steam Deck spatial navigation', () => {
    expect(hero.match(/data-focusable=\{\$gameMode \? undefined : ''\}/g)?.length).toBe(3)
    expect(hero.match(/tabindex=\{\$gameMode \? -1 : undefined\}/g)?.length).toBe(3)
  })

  it('makes Watch Now the row entry target and reveals the complete hero', () => {
    expect(hero).toContain('<div\n    data-nav-row')
    expect(hero).toContain('<div data-nav-row-items class="mt-4 flex items-center gap-2">')
    expect(hero).toContain('<button data-focusable data-nav-row-default data-nav-scroll-top')
  })

  it('steps directionally after an enabled mouse drag', () => {
    expect(hero).toContain("import { dragCarousels, wheelScrollAcross } from '$lib/settings/ui'")
    expect(hero).toContain("e.pointerType !== 'mouse'")
    expect(hero).toContain('if (!$dragCarousels')
    expect(hero).toContain('Math.abs(dx) >= 48')
    expect(hero).toContain('step(dx < 0 ? 1 : -1)')
    expect(hero).toContain('onpointercancel={(e) => endHeroPointer(e, false)}')
  })

  it('steps once per two-finger horizontal trackpad gesture', () => {
    expect(hero).toContain('dragCarousels, wheelScrollAcross')
    expect(hero).toContain('Math.abs(e.deltaX) <= Math.abs(e.deltaY)')
    expect(hero).toContain('if (Math.abs(heroWheelTotal) < 24) return')
    expect(hero).toContain('now - heroWheelSteppedAt > 160')
    expect(hero).toContain('magnitude >= Math.max(10, heroWheelLastMagnitude * 1.8)')
    expect(hero).toContain('if (!freshGesture) return')
    expect(hero).toContain('step(heroWheelTotal < 0 ? -1 : 1)')
    expect(hero).toContain('onwheel={onHeroWheel}')
  })

  it('uses the compact Game-mode detail backdrop height', () => {
    expect(hero).toContain("{showOverlay ? 'sm:h-[50vh]' : $gameMode ? 'sm:h-[42vh]' : 'sm:h-[48vh]'}")
  })

  it('keeps genre labels near-white over variable artwork', () => {
    expect(hero.match(/font-bold text-white\/90/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
