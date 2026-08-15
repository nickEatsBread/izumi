import { describe, expect, it, vi } from 'vitest'
import { resolveKitsuMapping } from './kitsu-resolution'

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
})
