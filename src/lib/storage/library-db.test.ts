import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', new MemoryStorage())
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const module = () => import('./library-db')

describe('durable library database', () => {
  it('migrates every title, retires the legacy value only after commit, and survives a restart', async () => {
    const history = Object.fromEntries(Array.from({ length: 5000 }, (_, id) => [id, { title: `作品 ${id}`, progress: id % 20 }]))
    localStorage.setItem('local-history', JSON.stringify(history))
    let db = await module()
    const store = db.databasePersisted('local-history', {}, db.mapCodec())
    expect(localStorage.getItem('local-history')).not.toBeNull()
    await store.ready
    expect(localStorage.getItem('local-history')).toBeNull()
    expect(get(store)).toEqual(history)
    vi.resetModules()
    db = await module()
    const reopened = db.databasePersisted('local-history', {}, db.mapCodec())
    await reopened.ready
    expect(get(reopened)).toEqual(history)
  })

  it('updates only the changed title rather than rewriting thousands of records', async () => {
    const db = await module()
    const initial = Object.fromEntries(Array.from({ length: 1500 }, (_, id) => [id, { progress: 1 }]))
    const store = db.databasePersisted('local-history', initial, db.mapCodec<{ progress: number }>())
    await store.ready
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    store.update(value => ({ ...value, '123': { progress: 2 } }))
    await store.flush()
    const written = put.mock.calls.map(([value]) => value).filter(value => value?.collection === 'local-history')
    expect(written).toEqual([{ collection: 'local-history', id: '123', value: { progress: 2 } }])
  })

  it('persists a reactive proxy as a plain snapshot instead of failing the structured clone', async () => {
    const db = await module()
    const store = db.databasePersisted<Record<string, { title: string; cover: { url: string } }>>(
      'local-history', {}, db.mapCodec())
    await store.ready
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    // Reads like Svelte's deep $state proxy: every nested object read hands out a fresh proxy.
    const reactive = <T>(value: T): T => new Proxy(value as object, {
      get: (target, key, receiver) => {
        const item = Reflect.get(target, key, receiver)
        return item && typeof item === 'object' ? reactive(item) : item
      },
    }) as T
    const proxied = reactive({ title: 'Film', cover: { url: 'https://image.test/x.jpg' } })
    store.update(value => ({ ...value, '-42': proxied }))
    await store.flush()
    const written = put.mock.calls.map(([value]) => value).filter(value => value?.collection === 'local-history')
    expect(written).toHaveLength(1)
    expect(() => structuredClone(written[0]!.value)).not.toThrow() // the exact IndexedDB failure mode
    expect(written[0]!.value).not.toBe(proxied)
    expect(written[0]!.value).toEqual({ title: 'Film', cover: { url: 'https://image.test/x.jpg' } })
  })

  it('replays additions and deletions made during hydration without dropping unrelated titles', async () => {
    let db = await module()
    const original = db.databasePersisted('local-history', { a: 1, b: 2 }, db.mapCodec<number>())
    await original.ready
    vi.resetModules()
    db = await module()
    const store = db.databasePersisted<Record<string, number>>('local-history', {}, db.mapCodec())
    store.update(value => ({ ...value, c: 3 }))
    store.update(value => { const next = { ...value }; delete next.a; return next })
    await store.ready
    expect(get(store)).toEqual({ b: 2, c: 3 })
    vi.resetModules()
    db = await module()
    const reopened = db.databasePersisted('local-history', {}, db.mapCodec())
    await reopened.ready
    expect(get(reopened)).toEqual({ b: 2, c: 3 })
  })

  it('keeps the legacy copy when migration cannot commit', async () => {
    localStorage.setItem('local-history', '{"kept":{"progress":9}}')
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Disk full', 'QuotaExceededError') })
    const db = await module()
    const store = db.databasePersisted('local-history', {}, db.mapCodec())
    await expect(store.ready).rejects.toThrow('Disk full')
    expect(localStorage.getItem('local-history')).toBe('{"kept":{"progress":9}}')
    expect(get(db.libraryStorageError)).toContain('Disk full')
  })

  it('exports unsaved edits when storage fills, then retries the write successfully', async () => {
    const db = await module()
    const store = db.databasePersisted('local-history', { a: 1 }, db.mapCodec<number>())
    await store.ready
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Disk full', 'QuotaExceededError') })
    store.update(value => ({ ...value, a: 2 }))
    await expect(store.flush()).rejects.toThrow('Disk full')
    expect(JSON.parse((await db.exportLibraryStorage())['local-history'])).toEqual({ a: 2 })
    put.mockRestore()
    await store.flush()
    vi.resetModules()
    const restarted = await module()
    const reopened = restarted.databasePersisted('local-history', {}, restarted.mapCodec())
    await reopened.ready
    expect(get(reopened)).toEqual({ a: 2 })
  })

  it('preserves saved lists, ordering, queues and tombstones and backs up inactive profiles', async () => {
    let db = await module()
    const state = { lists: [{ id: 'watchlist' }], entries: { 'tmdb:1': { title: 'Film' } }, queue: [{ id: 'ep1' }], deletedEntries: { old: 123 }, listOrderUpdatedAt: 2 }
    localStorage.setItem('izumi-profile:child:local-media-library-v1', JSON.stringify(state))
    const store = db.databasePersisted('izumi-profile:child:local-media-library-v1', { entries: {} }, db.objectCodec({ entries: {} }))
    await store.ready
    vi.resetModules()
    db = await module()
    const backup = await db.exportLibraryStorage()
    expect(JSON.parse(backup['izumi-profile:child:local-media-library-v1'])).toEqual(state)
    await db.restoreLibraryStorage({ 'local-history': '{"main":{"progress":10}}' })
    expect(JSON.parse((await db.exportLibraryStorage())['local-history'])).toEqual({ main: { progress: 10 } })
    await db.deleteLibraryProfile('child')
    expect(await db.exportLibraryStorage()).not.toHaveProperty('izumi-profile:child:local-media-library-v1')
  })

  it('restores an active collection before later edits and rolls back a failed replacement', async () => {
    let db = await module()
    const store = db.databasePersisted('local-history', { old: 1 }, db.mapCodec<number>())
    await store.ready
    await db.restoreLibraryStorage({ 'local-history': '{"restored":2}' })
    expect(get(store)).toEqual({ restored: 2 })
    store.update(value => ({ ...value, next: 3 }))
    await store.flush()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Disk full', 'QuotaExceededError') })
    await expect(db.restoreLibraryStorage({ 'local-history': '{"lost":4}' })).rejects.toThrow()
    put.mockRestore()
    expect(get(store)).toEqual({ restored: 2, next: 3 })
    vi.resetModules()
    db = await module()
    const reopened = db.databasePersisted('local-history', {}, db.mapCodec())
    await reopened.ready
    expect(get(reopened)).toEqual({ restored: 2, next: 3 })
  })
})
