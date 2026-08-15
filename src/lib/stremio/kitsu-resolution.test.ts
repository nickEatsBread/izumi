import { afterEach, describe, expect, it, vi } from 'vitest'
import { KITSU_MAPPING_HEDGE_MS, resolveKitsuMapping } from './kitsu-resolution'

afterEach(() => vi.useRealTimers())

describe('Kitsu mapping cost order', () => {
  it('does not touch the bulk index when the per-title record answers', async () => {
    const bulk = vi.fn(async () => 30)
    await expect(resolveKitsuMapping(async () => 10, async () => 20, bulk)).resolves.toBe(10)
    expect(bulk).not.toHaveBeenCalled()
  })

  it('retains MAL and bulk fallbacks', async () => {
    const bulk = vi.fn(async () => 30)
    await expect(resolveKitsuMapping(async () => undefined, async () => 20, bulk)).resolves.toBe(20)
    expect(bulk).not.toHaveBeenCalled()
    await expect(resolveKitsuMapping(async () => undefined, async () => undefined, bulk)).resolves.toBe(30)
    expect(bulk).toHaveBeenCalledOnce()
  })

  it('hedges a slow per-title request with the lightweight MAL lookup', async () => {
    vi.useFakeTimers()
    let finishPerTitle!: (value: number | undefined) => void
    const perTitle = new Promise<number | undefined>((resolve) => { finishPerTitle = resolve })
    const byMalId = vi.fn(async () => 20)
    const bulk = vi.fn(async () => 30)

    const result = resolveKitsuMapping(() => perTitle, byMalId, bulk)
    expect(byMalId).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(KITSU_MAPPING_HEDGE_MS)
    await expect(result).resolves.toBe(20)
    expect(byMalId).toHaveBeenCalledOnce()
    expect(bulk).not.toHaveBeenCalled()
    finishPerTitle(undefined)
  })

  it('starts the MAL fallback immediately after a fast miss', async () => {
    vi.useFakeTimers()
    const byMalId = vi.fn(async () => 20)
    const result = resolveKitsuMapping(async () => undefined, byMalId, async () => 30)

    await expect(result).resolves.toBe(20)
    expect(byMalId).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for both lightweight lookups before loading the bulk index', async () => {
    vi.useFakeTimers()
    let finishPerTitle!: (value: number | undefined) => void
    const perTitle = new Promise<number | undefined>((resolve) => { finishPerTitle = resolve })
    const bulk = vi.fn(async () => 30)
    const result = resolveKitsuMapping(() => perTitle, async () => undefined, bulk)

    await vi.advanceTimersByTimeAsync(KITSU_MAPPING_HEDGE_MS)
    expect(bulk).not.toHaveBeenCalled()
    finishPerTitle(undefined)
    await expect(result).resolves.toBe(30)
    expect(bulk).toHaveBeenCalledOnce()
  })

  it('continues through a failed lightweight lookup', async () => {
    await expect(resolveKitsuMapping(
      async () => { throw new Error('temporary failure') },
      async () => 20,
      async () => 30,
    )).resolves.toBe(20)
  })
})
