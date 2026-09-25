// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadStore, STORE_REFRESH_MS, type StoreLoadDeps } from './load'
import type { StoreFeed } from './feeds'

const KEY = `ed25519:${'A'.repeat(43)}=`
const FP = 'd'.repeat(64)
const INDEX = 'https://x.test/index.json'
const SIG = 'https://x.test/index.json.sig'
const CACHE_KEY = 'store-listing-cache-v1:u-test'
const feed = (patch: Partial<StoreFeed> = {}): StoreFeed => ({ id: 'u-test', url: INDEX, name: 'Test', enabled: true, addedAt: 0, ...patch })
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({
  app: 'izumi', kind: 'store', schemaVersion: 1, id: 'com.example.store', name: 'Example',
  entries: [{ kind: 'source', sourceType: 'stream-provider', id: 'one', name: 'One', manifestUrl: 'https://x.test/one.json' }],
  ...extra,
})
const staleCopy = JSON.stringify({ url: INDEX, listing: { storeId: 'u-test', adapter: 'izumi-store', entries: [], skipped: 0 }, trust: { state: 'unsigned' }, fetchedAt: 0 })

function deps(
  pages: Record<string, string | Error>,
  options: { verify?: (body: string, signature: string, key: string) => string; now?: number } = {},
): StoreLoadDeps & { cacheData: Map<string, string>; fetched: string[] } {
  const cacheData = new Map<string, string>()
  const fetched: string[] = []
  return {
    cacheData,
    fetched,
    fetchText: async (url) => {
      fetched.push(url)
      const page = pages[url]
      if (page === undefined) throw new Error(`HTTP 404 for ${url}`)
      if (page instanceof Error) throw page
      return page
    },
    verify: async (body, signature, key) => {
      if (!options.verify) throw new Error('no verifier')
      return options.verify(body, signature, key)
    },
    now: () => options.now ?? 1_000_000,
    cache: { getItem: (key) => cacheData.get(key) ?? null, setItem: (key, value) => { cacheData.set(key, value) } },
  }
}

describe('loadStore', () => {
  it('fetches, adapts and caches an unsigned store', async () => {
    const d = deps({ [INDEX]: doc() })
    const result = await loadStore(feed(), {}, d)
    expect(result).toMatchObject({ cached: false, trust: { state: 'unsigned' } })
    expect(result.listing?.entries).toHaveLength(1)
    expect(d.cacheData.has(CACHE_KEY)).toBe(true)
  })

  it('serves a fresh copy without fetching, and refetches when forced', async () => {
    const d = deps({ [INDEX]: doc() })
    await loadStore(feed(), {}, d)
    d.fetched.length = 0
    expect((await loadStore(feed(), {}, d)).cached).toBe(true)
    expect(d.fetched).toEqual([])
    await loadStore(feed(), { force: true }, d)
    expect(d.fetched).toEqual([INDEX])
  })

  it('refetches a stale copy', async () => {
    const d = deps({ [INDEX]: doc() }, { now: STORE_REFRESH_MS * 3 })
    d.cacheData.set(CACHE_KEY, staleCopy)
    const result = await loadStore(feed(), {}, d)
    expect(result.cached).toBe(false)
    expect(result.listing?.entries).toHaveLength(1)
  })

  it('falls back to the last good copy when the store is unreachable', async () => {
    const d = deps({ [INDEX]: new Error('offline') }, { now: STORE_REFRESH_MS * 3 })
    d.cacheData.set(CACHE_KEY, staleCopy)
    expect(await loadStore(feed(), {}, d)).toMatchObject({ cached: true, error: 'offline' })
  })

  it('reports an unreachable store that has no saved copy', async () => {
    const result = await loadStore(feed(), {}, deps({}))
    expect(result.listing).toBeUndefined()
    expect(result.error).toContain('HTTP 404')
  })

  it('verifies a signed store against its detached signature and asks to pin the key once', async () => {
    const body = doc({ publicKey: KEY })
    const d = deps({ [INDEX]: body, [SIG]: 'c2ln\n' }, {
      verify: (verifiedBody, signature, key) => {
        expect([verifiedBody, signature, key]).toEqual([body, 'c2ln', KEY])
        return FP
      },
    })
    expect((await loadStore(feed(), {}, d)).trust).toEqual({ state: 'signed', fingerprint: FP, pin: FP })
    expect((await loadStore(feed({ pinnedKey: FP }), { force: true }, d)).trust).toEqual({ state: 'signed', fingerprint: FP })
  })

  it('locks a store whose key changed, whose signature fails, or that stopped signing — and never caches it', async () => {
    const body = doc({ publicKey: KEY })
    const changed = deps({ [INDEX]: body, [SIG]: 'c2ln' }, { verify: () => 'e'.repeat(64) })
    expect((await loadStore(feed({ pinnedKey: FP }), {}, changed)).trust).toEqual({ state: 'locked', reason: 'key-changed', fingerprint: 'e'.repeat(64) })
    expect(changed.cacheData.size).toBe(0)
    const bad = deps({ [INDEX]: body, [SIG]: 'c2ln' }, { verify: () => { throw new Error('bad') } })
    expect((await loadStore(feed(), {}, bad)).trust).toEqual({ state: 'locked', reason: 'bad-signature' })
    const stopped = deps({ [INDEX]: doc() })
    expect((await loadStore(feed({ pinnedKey: FP }), {}, stopped)).trust).toEqual({ state: 'locked', reason: 'key-removed' })
  })
})
