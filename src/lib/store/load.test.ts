// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadStore, StoreHttpError, STORE_REFRESH_MS, type StoreLoadDeps } from './load'
import type { StoreFeed } from './feeds'

const KEY = `ed25519:${'A'.repeat(43)}=`
const FP = 'd'.repeat(64)
const NEW = 'e'.repeat(64)
const INDEX = 'https://x.test/index.json'
const SIG = 'https://x.test/index.json.sig'
const feed = (patch: Partial<StoreFeed> = {}): StoreFeed => ({ id: 'u-test', url: INDEX, name: 'Test', enabled: true, addedAt: 0, ...patch })
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({
  app: 'izumi', kind: 'store', schemaVersion: 1, id: 'com.example.store', name: 'Example',
  entries: [{ kind: 'source', sourceType: 'stream-provider', id: 'one', name: 'One', manifestUrl: 'https://x.test/one.json' }],
  ...extra,
})
const savedCopy = (fetchedAt: number, trust: object = { state: 'unsigned' }, entries: unknown[] = []) =>
  JSON.stringify({ url: INDEX, listing: { storeId: 'u-test', adapter: 'izumi-store', entries, skipped: 0 }, trust, fetchedAt })
const REFRESHED = STORE_REFRESH_MS * 3

function deps(
  pages: Record<string, string | Error>,
  options: { verify?: (body: string, signature: string, key: string) => string; now?: number } = {},
): StoreLoadDeps & { cacheData: Map<string, string>; fetched: Array<[string, number]> } {
  const cacheData = new Map<string, string>()
  const fetched: Array<[string, number]> = []
  return {
    cacheData,
    fetched,
    fetchText: async (url, maxBytes) => {
      fetched.push([url, maxBytes])
      const page = pages[url]
      if (page === undefined) throw new StoreHttpError(404)
      if (page instanceof Error) throw page
      return page
    },
    verify: async (body, signature, key) => {
      if (!options.verify) throw new Error('no verifier')
      return options.verify(body, signature, key)
    },
    now: () => options.now ?? 1_000_000,
    cache: { get: async (id) => cacheData.get(id), set: async (id, value) => { cacheData.set(id, value) } },
  }
}

describe('loadStore', () => {
  it('never pins a key from a saved copy, so clearing a pin sticks', async () => {
    const d = deps({})
    d.cacheData.set('u-test', savedCopy(1_000_000 - 1_000, { state: 'signed', fingerprint: FP }))
    const result = await loadStore(feed(), {}, d)
    expect(result.cached).toBe(true)
    expect(result.trust).toEqual({ state: 'signed', fingerprint: FP })
  })

  it('fetches, adapts and saves an unsigned store', async () => {
    const d = deps({ [INDEX]: doc() })
    const result = await loadStore(feed(), {}, d)
    expect(result).toMatchObject({ cached: false, trust: { state: 'unsigned' } })
    expect(result.listing?.entries).toHaveLength(1)
    expect(d.cacheData.has('u-test')).toBe(true)
  })

  it('serves a fresh copy without fetching, and refetches when forced', async () => {
    const d = deps({ [INDEX]: doc() })
    await loadStore(feed(), {}, d)
    d.fetched.length = 0
    expect((await loadStore(feed(), {}, d)).cached).toBe(true)
    expect(d.fetched).toEqual([])
    await loadStore(feed(), { force: true }, d)
    expect(d.fetched.map(([url]) => url)).toEqual([INDEX])
  })

  it('refetches a stale copy, and never treats a future timestamp as fresh', async () => {
    const stale = deps({ [INDEX]: doc() }, { now: REFRESHED })
    stale.cacheData.set('u-test', savedCopy(0))
    expect((await loadStore(feed(), {}, stale)).cached).toBe(false)
    const future = deps({ [INDEX]: doc() }, { now: 1_000 })
    future.cacheData.set('u-test', savedCopy(9_999_999))
    expect((await loadStore(feed(), {}, future)).cached).toBe(false)
  })

  it('falls back to the last good copy when the store is unreachable', async () => {
    const d = deps({ [INDEX]: new Error('offline') }, { now: REFRESHED })
    d.cacheData.set('u-test', savedCopy(0))
    expect(await loadStore(feed(), {}, d)).toMatchObject({ cached: true, error: 'offline' })
  })

  it('reports an unreachable store that has no saved copy, and ignores a corrupt one', async () => {
    const d = deps({})
    d.cacheData.set('u-test', JSON.stringify({ url: INDEX, listing: { entries: [] } }))
    const result = await loadStore(feed(), {}, d)
    expect(result.listing).toBeUndefined()
    expect(result.error).toBe('The store returned HTTP 404.')
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
    expect(d.fetched).toContainEqual([SIG, 4_096])
    expect((await loadStore(feed({ pinnedKey: FP }), { force: true }, d)).trust).toEqual({ state: 'signed', fingerprint: FP })
  })

  it('locks a store whose key changed, whose signature fails or is missing, or that stopped signing — and never shows or saves it', async () => {
    const body = doc({ publicKey: KEY })
    const changed = deps({ [INDEX]: body, [SIG]: 'c2ln' }, { verify: () => NEW })
    const result = await loadStore(feed({ pinnedKey: FP }), {}, changed)
    expect(result.trust).toEqual({ state: 'locked', reason: 'key-changed', fingerprint: NEW })
    expect(result.listing).toBeUndefined()
    expect(changed.cacheData.size).toBe(0)
    const bad = deps({ [INDEX]: body, [SIG]: 'c2ln' }, { verify: () => { throw new Error('bad') } })
    expect((await loadStore(feed(), {}, bad)).trust).toEqual({ state: 'locked', reason: 'bad-signature' })
    const missing = deps({ [INDEX]: body }, { verify: () => FP })
    expect((await loadStore(feed(), {}, missing)).trust).toEqual({ state: 'locked', reason: 'bad-signature' })
    const stopped = deps({ [INDEX]: doc() })
    expect((await loadStore(feed({ pinnedKey: FP }), {}, stopped)).trust).toEqual({ state: 'locked', reason: 'key-removed' })
  })

  it('treats a signature that could not be fetched as a failed load, not a failed check', async () => {
    const d = deps({ [INDEX]: doc({ publicKey: KEY }), [SIG]: new Error('offline') }, { verify: () => FP })
    const result = await loadStore(feed({ pinnedKey: FP }), {}, d)
    expect(result.trust.state).not.toBe('locked')
    expect(result.error).toBe('offline')
  })

  it('keeps showing the last copy that passed when a new listing fails its check', async () => {
    const d = deps({ [INDEX]: doc({ publicKey: KEY }), [SIG]: 'c2ln' }, { verify: () => NEW, now: REFRESHED })
    d.cacheData.set('u-test', savedCopy(0, { state: 'signed', fingerprint: FP }, [{ key: 'u-test:source:old' }]))
    const result = await loadStore(feed({ pinnedKey: FP }), {}, d)
    expect(result.trust).toMatchObject({ state: 'locked', reason: 'key-changed' })
    expect(result.listing?.entries).toHaveLength(1)
    expect(result.cached).toBe(true)
  })

  it('refetches instead of serving a fresh copy that no longer passes (the pin just changed)', async () => {
    const d = deps({ [INDEX]: doc({ publicKey: KEY }), [SIG]: 'c2ln' }, { verify: () => NEW })
    d.cacheData.set('u-test', savedCopy(999_000, { state: 'signed', fingerprint: FP }))
    const result = await loadStore(feed({ pinnedKey: NEW }), {}, d)
    expect(result).toMatchObject({ cached: false, trust: { state: 'signed', fingerprint: NEW } })
    expect(d.fetched.map(([url]) => url)).toContain(INDEX)
  })

  it('does not save a load made only to preview a store', async () => {
    const d = deps({ [INDEX]: doc() })
    await loadStore(feed(), { force: true, save: false }, d)
    expect(d.cacheData.size).toBe(0)
  })
})
