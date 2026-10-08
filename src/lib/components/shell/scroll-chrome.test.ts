// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromeTracker, resetScrollChrome, scrollChrome, startScrollChrome, stepChrome, type ChromeRule, type ChromeTracker } from './scroll-chrome'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** The states after scrolling through `positions` in order. */
function walk(rule: ChromeRule, positions: number[], from: ChromeTracker = chromeTracker()): string[] {
  let tracker = from
  return positions.map((y) => (tracker = stepChrome(tracker, y, rule)).state)
}
const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor(Math.abs(to - from) / step) + 1 }, (_, index) => from + Math.sign(to - from) * step * index)

describe('scroll chrome state machine', () => {
  it("keeps izumi's own rule without a threshold: more than 6 px down past y 64 hides, more than 6 px up returns", () => {
    expect(walk({}, [10, 40, 70, 80])).toEqual(['shown', 'shown', 'hidden', 'hidden'])
    // 6 px a step never flips it, either way.
    expect(walk({}, [100, 106, 112, 118])).toEqual(['hidden', 'hidden', 'hidden', 'hidden'])
    expect(walk({}, [100, 94, 88])).toEqual(['hidden', 'hidden', 'hidden'])
    expect(walk({}, [300, 290, 285])).toEqual(['hidden', 'shown', 'shown'])
    expect(walk({}, [300, 63])).toEqual(['hidden', 'shown'])
    // `scroll` is the same rule, and `collapse` reports `collapsed` instead of `hidden`.
    expect(walk({ hide: 'scroll' }, [0, 200])).toEqual(['shown', 'hidden'])
    expect(walk({ hide: 'collapse' }, [0, 200, 100])).toEqual(['shown', 'collapsed', 'shown'])
  })

  it('never moves under `never`', () => {
    expect(walk({ hide: 'never' }, [0, 400, 800, 20])).toEqual(['shown', 'shown', 'shown', 'shown'])
    expect(walk({ hide: 'never', threshold: 8 }, [0, 400])).toEqual(['shown', 'shown'])
  })

  it('collapses after the threshold scrolled down in 10 px steps, and returns after the same distance up', () => {
    const rule: ChromeRule = { hide: 'collapse', threshold: 60 }
    const down = walk(rule, range(10, 200, 10))
    expect(down.slice(0, 5)).toEqual(['shown', 'shown', 'shown', 'shown', 'shown'])
    expect(down[5]).toBe('collapsed') // y 60: 60 px scrolled down
    expect(new Set(down.slice(5))).toEqual(new Set(['collapsed']))
    let tracker = chromeTracker()
    for (const y of range(10, 200, 10)) tracker = stepChrome(tracker, y, rule)
    const up = walk(rule, range(190, 140, 10), tracker)
    expect(up).toEqual(['collapsed', 'collapsed', 'collapsed', 'collapsed', 'collapsed', 'shown'])
  })

  it('starts the count again when the direction changes', () => {
    const rule: ChromeRule = { hide: 'scroll', threshold: 24 }
    // 20 down, 10 up, 20 down: never 24 in one direction; 5 more down makes 25.
    expect(walk(rule, [120, 110, 130, 135], chromeTracker(100))).toEqual(['shown', 'shown', 'shown', 'hidden'])
  })

  it('is always shown within 8 px of the top', () => {
    const rule: ChromeRule = { hide: 'collapse', threshold: 60 }
    let tracker = chromeTracker()
    for (const y of range(10, 400, 10)) tracker = stepChrome(tracker, y, rule)
    expect(tracker.state).toBe('collapsed')
    expect(stepChrome(tracker, 8, rule).state).toBe('shown')
    // A jump straight to the top counts even though it is one step.
    expect(walk(rule, [400, 0], tracker)).toEqual(['collapsed', 'shown'])
  })
})

describe('scroll chrome runtime', () => {
  let stop: () => void = () => {}
  const scrollTo = (y: number) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
    window.dispatchEvent(new Event('scroll'))
  }
  const scrollThrough = (positions: number[]) => positions.forEach(scrollTo)
  beforeEach(() => scrollTo(0))
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('publishes the state on <html> and in the store, and folds a collapse rule without hiding', () => {
    const rule = writable<ChromeRule | undefined>({ hide: 'collapse', threshold: 60 })
    stop = startScrollChrome({ rule, dock: writable(false) })
    expect(document.documentElement.dataset.chrome).toBe('shown')
    scrollThrough(range(10, 50, 10))
    expect(get(scrollChrome)).toBe('shown')
    scrollTo(60)
    expect(get(scrollChrome)).toBe('collapsed')
    expect(document.documentElement.dataset.chrome).toBe('collapsed')
    scrollThrough(range(50, 0, 10))
    expect(document.documentElement.dataset.chrome).toBe('shown')
  })

  it('returns after the idle time without scrolling', () => {
    vi.useFakeTimers()
    stop = startScrollChrome({ rule: writable({ hide: 'scroll', threshold: 24, idle: 1000 }), dock: writable(false) })
    scrollThrough(range(10, 100, 10))
    expect(get(scrollChrome)).toBe('hidden')
    vi.advanceTimersByTime(900)
    expect(get(scrollChrome)).toBe('hidden')
    // Scrolling again restarts the wait.
    scrollTo(110)
    vi.advanceTimersByTime(900)
    expect(get(scrollChrome)).toBe('hidden')
    vi.advanceTimersByTime(200)
    expect(get(scrollChrome)).toBe('shown')
    expect(document.documentElement.dataset.chrome).toBe('shown')
    // It takes a whole threshold again to leave.
    scrollTo(130)
    expect(get(scrollChrome)).toBe('shown')
    scrollTo(140)
    expect(get(scrollChrome)).toBe('hidden')
  })

  it('never returns on its own without an idle time', () => {
    vi.useFakeTimers()
    stop = startScrollChrome({ rule: writable({ hide: 'scroll', threshold: 24 }), dock: writable(false) })
    scrollThrough(range(10, 100, 10))
    vi.advanceTimersByTime(10_000)
    expect(get(scrollChrome)).toBe('hidden')
  })

  it('stays shown while the mini-player is docked on the bar', () => {
    const dock = writable(true)
    stop = startScrollChrome({ rule: writable(undefined), dock })
    scrollThrough([0, 200, 400])
    expect(get(scrollChrome)).toBe('shown')
    expect(document.documentElement.dataset.chrome).toBe('shown')
    dock.set(false)
    scrollTo(600)
    expect(get(scrollChrome)).toBe('hidden')
  })

  it('resets on navigation and when the rule changes, and cleans up when stopped', () => {
    const rule = writable<ChromeRule | undefined>(undefined)
    stop = startScrollChrome({ rule, dock: writable(false) })
    scrollThrough([0, 200, 400])
    expect(get(scrollChrome)).toBe('hidden')
    resetScrollChrome()
    expect(get(scrollChrome)).toBe('shown')
    // The count starts from where the page is now.
    scrollTo(404)
    expect(get(scrollChrome)).toBe('shown')
    scrollTo(500)
    expect(get(scrollChrome)).toBe('hidden')
    rule.set({ hide: 'never' })
    expect(get(scrollChrome)).toBe('shown')
    scrollTo(900)
    expect(get(scrollChrome)).toBe('shown')
    stop()
    expect(document.documentElement.dataset.chrome).toBeUndefined()
    scrollTo(1200)
    expect(get(scrollChrome)).toBe('shown')
  })

  it('is started by the shell and read by the bottom bar, also where a series page hides the bar', () => {
    const layout = read('../../../routes/app/+layout.svelte')
    expect(layout).toContain('onMount(() => startScrollChrome({')
    expect(layout).toContain('afterNavigate(() => resetScrollChrome())')
    // Started outside the `{#if !$bottomNavSuppressed}<BottomNav />` branch, so it outlives the bar.
    expect(layout.indexOf('startScrollChrome({')).toBeLessThan(layout.indexOf('</script>'))
    const nav = read('./BottomNav.svelte')
    expect(nav).toContain('data-state={$scrollChrome}')
    expect(nav).toContain("const hidden = $derived($scrollChrome === 'hidden')")
    expect(nav).not.toContain("addEventListener('scroll'")
  })
})
