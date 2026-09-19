import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@urql/exchange-graphcache'
import { createAnilistPersistence, gatedStorage, revalidatedPolicy } from './persisted-cache'

const client = readFileSync(fileURLToPath(new URL('./client.ts', import.meta.url)), 'utf8')

const op = (kind: 'query' | 'mutation', key: number, requestPolicy = 'cache-first') =>
  ({ kind, key, context: { requestPolicy } }) as Parameters<typeof revalidatedPolicy>[0]

describe('persisted AniList cache', () => {
  it('revalidates each cache-first query once per session and never touches other policies', () => {
    const seen = new Set<number>()
    expect(revalidatedPolicy(op('query', 1), seen)).toBe('cache-and-network')
    // Same query again (Home ⇄ detail ⇄ Home) stays cache-first: no extra AniList quota.
    expect(revalidatedPolicy(op('query', 1), seen)).toBeNull()
    expect(revalidatedPolicy(op('query', 2), seen)).toBe('cache-and-network')
    expect(revalidatedPolicy(op('query', 3, 'network-only'), seen)).toBeNull()
    expect(revalidatedPolicy(op('query', 4, 'cache-only'), seen)).toBeNull()
    expect(revalidatedPolicy(op('mutation', 5), seen)).toBeNull()
    expect(seen.has(3)).toBe(false)
  })

  it('drops writes while blocked (incognito / retired) but keeps reads', async () => {
    const writeData = vi.fn(() => Promise.resolve())
    const readData = vi.fn(() => Promise.resolve({}))
    const base = { writeData, readData } as unknown as StorageAdapter
    let blocked = true
    const gated = gatedStorage(base, () => blocked)
    await gated.writeData({})
    expect(writeData).not.toHaveBeenCalled()
    blocked = false
    await gated.writeData({ a: 'b' })
    expect(writeData).toHaveBeenCalledWith({ a: 'b' })
    expect(gated.readData).toBe(readData)
  })

  it('is absent where IndexedDB is unavailable', () => {
    expect(typeof indexedDB).toBe('undefined')
    expect(createAnilistPersistence(() => false)).toBeNull()
  })

  it('is wired ahead of graphcache and wiped on an account switch', () => {
    expect(client).toMatch(/exchanges: \[\s*revalidateOnceExchange\(\),\s*cacheExchange\(\{ keys: ANILIST_CACHE_KEYS, storage: /)
    expect(client).toContain('createAnilistPersistence(() => get(incognito))')
    // The old client (and its in-memory viewer fields) must go synchronously; the disk copy is
    // retired before a persisted client is built again.
    expect(client).toContain('client = createAnilistClient(null)')
    expect(client).toContain('.retire()')
  })
})
