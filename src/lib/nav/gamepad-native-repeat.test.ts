// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The native reader's events, captured so the test can send them as the Deck would.
const handlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>())
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => { handlers.set(name, handler); return () => handlers.delete(name) },
  emit: async () => {},
}))
vi.mock('$lib/player/series-rating', async () => {
  const { writable } = await import('svelte/store')
  return { seriesRatingPrompt: writable(null) }
})
vi.mock('$lib/search/global-search', async () => {
  const { writable } = await import('svelte/store')
  return { globalSearchOpen: writable(false), closeGlobalSearch: () => {} }
})
vi.mock('$app/navigation', () => ({ goto: vi.fn() }))

import { startGamepadNav } from './gamepad'
import { isPadEvent } from './pad-controls'

const keys: string[] = []
const record = (event: KeyboardEvent) => { if (isPadEvent(event)) keys.push(`${event.key}${event.repeat ? '+' : ''}`) }
const native = (name: string, payload: unknown) => handlers.get(name)?.({ payload })
let frames: FrameRequestCallback[] = []
let stop: () => void = () => {}

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  history.replaceState(null, '', '/app/settings/player')
  window.addEventListener('keydown', record)
  stop = startGamepadNav()
  await vi.waitFor(() => expect(handlers.has('gamepad-repeat')).toBe(true))
})
afterEach(() => {
  stop()
  window.removeEventListener('keydown', record)
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  keys.length = 0
  frames = []
  vi.unstubAllGlobals()
})

describe('native d-pad repeats', () => {
  it('steps once per press however late the release arrives, and repeats only when the reader says so', () => {
    native('gamepad-input', { name: 'down', pressed: true })
    expect(keys).toEqual(['ArrowDown'])
    // A stalled page running its frames long after the press: the page never repeats on its own.
    const start = performance.now()
    const clock = vi.spyOn(performance, 'now')
    for (let tick = 0; tick < 4; tick++) {
      const at = start + 2000 + tick * 16
      clock.mockReturnValue(at)
      for (const frame of frames.splice(0)) frame(at)
    }
    expect(keys).toEqual(['ArrowDown'])
    native('gamepad-repeat', { name: 'down' })
    expect(keys).toEqual(['ArrowDown', 'ArrowDown+'])
    native('gamepad-input', { name: 'down', pressed: false })
    native('gamepad-repeat', { name: 'down' })
    expect(keys).toEqual(['ArrowDown', 'ArrowDown+'])
  })
})
