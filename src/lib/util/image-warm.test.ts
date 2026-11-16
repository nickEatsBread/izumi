import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageWarmer } from './image-warm'

// WebKitGTK paid each poster's decode on the frame a Home row first painted (60-120 ms per row on the
// Deck's first walk down). The warmer decodes the rows ahead one image a slice while nothing moves.

function setup() {
  const slices: (() => void)[] = []
  const decodes: { url: string; done: (ok: boolean) => void; fail: () => void }[] = []
  let busy = false
  const load = vi.fn((url: string) => url)
  const warmer = createImageWarmer<string>({
    load,
    decode: (url) => new Promise((resolve, reject) => decodes.push({ url, done: resolve, fail: () => reject(new Error('broken')) })),
    busy: () => busy,
    later: (fn) => {
      slices.push(fn)
      return () => { const at = slices.indexOf(fn); if (at >= 0) slices.splice(at, 1) }
    },
    limit: 3,
  })
  return { warmer, load, decodes, slices, slice: () => slices.shift()?.(), setBusy: (value: boolean) => { busy = value } }
}
// Lets the decode's promise chain run.
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('image warmer', () => {
  it('fetches every wanted image at once but decodes one a slice, nearest first', async () => {
    const { warmer, load, decodes, slices, slice } = setup()
    warmer.warm(['a', 'b', 'c'])
    expect(load.mock.calls.map(([url]) => url)).toEqual(['a', 'b', 'c'])
    expect(decodes).toHaveLength(0)
    slice()
    expect(decodes.map((d) => d.url)).toEqual(['a'])
    // Nothing else is scheduled while a decode runs.
    expect(slices).toHaveLength(0)
    decodes[0].done(true)
    await settle()
    expect([...warmer.held.keys()]).toEqual(['a'])
    slice()
    expect(decodes.map((d) => d.url)).toEqual(['a', 'b'])
  })

  it('waits while the page is busy and comes back once it is not', async () => {
    const { warmer, decodes, setBusy, slice } = setup()
    setBusy(true)
    warmer.warm(['a'])
    slice()
    await vi.advanceTimersByTimeAsync(400)
    expect(decodes).toHaveLength(0)
    setBusy(false)
    await vi.advanceTimersByTimeAsync(400)
    expect(decodes.map((d) => d.url)).toEqual(['a'])
  })

  it('holds at most its limit, dropping the least recently wanted, and never decodes a held image again', async () => {
    const { warmer, load, decodes, slice } = setup()
    warmer.warm(['a', 'b', 'c'])
    for (let n = 0; n < 3; n++) { slice(); decodes[n].done(true); await settle() }
    expect([...warmer.held.keys()]).toEqual(['a', 'b', 'c'])
    // `a` is wanted again: it becomes the newest, so `b` is the one to go.
    warmer.warm(['a', 'd'])
    expect(load).toHaveBeenCalledTimes(4)
    slice()
    expect(decodes[3].url).toBe('d')
    decodes[3].done(true)
    await settle()
    expect([...warmer.held.keys()]).toEqual(['c', 'a', 'd'])
  })

  it('replaces what waits with the new rows, reusing images already fetched', async () => {
    const { warmer, load, decodes, slice } = setup()
    warmer.warm(['a', 'b'])
    warmer.warm(['b', 'c'])
    expect(load.mock.calls.map(([url]) => url)).toEqual(['a', 'b', 'c'])
    slice()
    expect(decodes.map((d) => d.url)).toEqual(['b'])
    // The image being decoded is not fetched or queued a second time.
    warmer.warm(['b'])
    expect(load).toHaveBeenCalledTimes(3)
    decodes[0].done(true)
    await settle()
    slice()
    expect(decodes).toHaveLength(1)
  })

  it('drops an image that fails and carries on; stop clears what waits', async () => {
    const { warmer, decodes, slices, slice } = setup()
    warmer.warm(['a', 'b', 'c'])
    slice()
    decodes[0].fail()
    await settle()
    expect(warmer.held.size).toBe(0)
    slice()
    expect(decodes[1].url).toBe('b')
    warmer.stop()
    decodes[1].done(false)
    await settle()
    expect(warmer.held.size).toBe(0)
    expect(slices).toHaveLength(0)
  })
})
