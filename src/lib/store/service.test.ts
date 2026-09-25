// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ loadStore: vi.fn() }))
vi.mock('./load', () => ({ loadStore: mocks.loadStore }))

import { confirmStore, loadStoreAndPin, previewStore } from './service'
import { BUILTIN_STORES, allStores, storePins, userStores } from './feeds'
import type { StoreEntry } from './types'

const FP = 'f'.repeat(64)
let sequence = 0
const entry = (kind: StoreEntry['kind'], sourceType?: StoreEntry['sourceType']): StoreEntry => ({
  key: `x:${kind}:${sequence++}`, storeId: 'x', kind, sourceType, id: `id-${sequence}`, name: 'Name',
  languages: [], content: [], nsfw: false, requiresDebrid: false, install: { type: 'extension', spec: 'https://x.test/a.json' },
})
const preview = { url: 'https://x.test/index.json', name: 'X', domain: 'x.test', counts: [] as Array<[string, number]>, signed: false, skipped: 0 }

beforeEach(() => {
  userStores.set([])
  storePins.set({})
  mocks.loadStore.mockReset()
})

describe('previewStore', () => {
  it('resolves the link, loads it once, and summarises what it lists', async () => {
    mocks.loadStore.mockResolvedValue({
      store: {}, trust: { state: 'signed', fingerprint: FP, pin: FP }, fetchedAt: 1, cached: false,
      listing: { storeId: 'x', adapter: 'izumi-store', name: 'Example Store', skipped: 2,
        entries: [entry('source', 'stream-provider'), entry('source', 'stream-provider'), entry('theme')] },
    })
    const result = await previewStore('someone/stores')
    expect(mocks.loadStore).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://raw.githubusercontent.com/someone/stores/HEAD/index.json' }), { force: true })
    expect(result).toEqual({
      url: 'https://raw.githubusercontent.com/someone/stores/HEAD/index.json', name: 'Example Store', domain: 'raw.githubusercontent.com',
      counts: [['Streaming source', 2], ['Theme', 1]], signed: true, fingerprint: FP, skipped: 2,
    })
  })

  it('refuses bad links, built-in stores, known stores, failed loads and key mismatches', async () => {
    await expect(previewStore('http://x.test/index.json')).rejects.toThrow('HTTPS')
    await expect(previewStore(BUILTIN_STORES[0].url)).rejects.toThrow('built in')
    confirmStore(preview)
    await expect(previewStore('https://x.test/index.json')).rejects.toThrow('already added')
    mocks.loadStore.mockResolvedValueOnce({ trust: { state: 'unsigned' }, error: 'offline', fetchedAt: 0, cached: false })
    await expect(previewStore('https://y.test/index.json')).rejects.toThrow('offline')
    mocks.loadStore.mockResolvedValueOnce({ trust: { state: 'locked', reason: 'bad-signature' }, listing: { entries: [], skipped: 0 }, fetchedAt: 0, cached: false })
    await expect(previewStore('https://y.test/index.json')).rejects.toThrow("doesn't match")
  })
})

describe('confirmStore and loadStoreAndPin', () => {
  it('adds the previewed store with its key pinned', () => {
    const feed = confirmStore({ ...preview, signed: true, fingerprint: FP })
    expect(get(allStores).find((store) => store.id === feed.id)?.pinnedKey).toBe(FP)
  })

  it('pins a key the first time a loaded store shows one', async () => {
    const feed = confirmStore(preview)
    mocks.loadStore.mockResolvedValue({ store: feed, trust: { state: 'signed', fingerprint: FP, pin: FP }, fetchedAt: 1, cached: false })
    await loadStoreAndPin(feed)
    // Pins live in the device-local pin map, surfaced through allStores.
    expect(get(allStores).find((store) => store.id === feed.id)?.pinnedKey).toBe(FP)
  })
})
