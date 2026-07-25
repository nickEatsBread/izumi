import { describe, it, expect, beforeEach, vi } from 'vitest'
import { memo, clearProviderCache, providerCacheSize, cacheableList } from './online-cache'

beforeEach(() => clearProviderCache())

describe('memo', () => {
  it('runs the loader once per key and reuses the result', async () => {
    const load = vi.fn().mockResolvedValue(['a'])
    expect(await memo('k', load, cacheableList)).toEqual(['a'])
    expect(await memo('k', load, cacheableList)).toEqual(['a'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent callers into one request', async () => {
    // The dub and sub passes hit the same provider at the same instant; without sharing the
    // in-flight promise that is two identical network round trips.
    const load = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r(['x']), 5)))
    const [a, b] = await Promise.all([memo('k', load, cacheableList), memo('k', load, cacheableList)])
    expect(a).toEqual(['x'])
    expect(b).toEqual(['x'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps separate entries per key', async () => {
    const load = vi.fn().mockResolvedValue([])
    await memo('a', load, cacheableList)
    await memo('b', load, cacheableList)
    expect(load).toHaveBeenCalledTimes(2)
    expect(providerCacheSize()).toBe(2)
  })

  it('caches an empty list — a provider that lacks the show should not be re-asked per episode', async () => {
    const load = vi.fn().mockResolvedValue([])
    await memo('k', load, cacheableList)
    await memo('k', load, cacheableList)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failed call', async () => {
    // Providers return null on timeout. Caching that would blank the provider for the whole TTL.
    const load = vi.fn().mockResolvedValue(null)
    expect(await memo('k', load, cacheableList)).toBeNull()
    expect(providerCacheSize()).toBe(0)
    await memo('k', load, cacheableList)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does NOT cache a rejection, and propagates it', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(memo('k', load, cacheableList)).rejects.toThrow('boom')
    expect(providerCacheSize()).toBe(0)
  })

  it('re-runs the loader once the TTL has elapsed', async () => {
    const load = vi.fn().mockResolvedValue(['v'])
    await memo('k', load, cacheableList, 10)
    await new Promise((r) => setTimeout(r, 25))
    await memo('k', load, cacheableList, 10)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clearProviderCache drops everything', async () => {
    const load = vi.fn().mockResolvedValue(['v'])
    await memo('k', load, cacheableList)
    expect(providerCacheSize()).toBe(1)
    clearProviderCache()
    expect(providerCacheSize()).toBe(0)
    await memo('k', load, cacheableList)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('cacheableList', () => {
  it('accepts arrays, rejects null and non-arrays', () => {
    expect(cacheableList([])).toBe(true)
    expect(cacheableList([1])).toBe(true)
    expect(cacheableList(null)).toBe(false)
    expect(cacheableList(undefined)).toBe(false)
    expect(cacheableList({})).toBe(false)
  })
})
