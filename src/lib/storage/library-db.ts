import { get, writable, type Writable } from 'svelte/store'

// Separate from disposable metadata caches. Every title is a separate IndexedDB row, so changing
// one title does not serialize/rewrite the rest of a large library into localStorage.
const DATABASE = 'izumi-library-v1'
type Rows = Map<string, unknown>
const MAP_FIELD = { map: true }
export interface StateCodec<T> {
  encode(value: T): Rows
  decode(rows: Rows): T
}
export interface DatabaseStore<T> extends Writable<T> {
  ready: Promise<void>
  flush(): Promise<void>
  /** Adopt a backup that has already committed, without scheduling a second disk write. */
  acceptRestored(value: T): void
}
export const libraryStorageError = writable('')
let connection: Promise<IDBDatabase> | undefined
const stores = new Map<string, DatabaseStore<unknown>>()
let restoreBarrier: Promise<void> | undefined
let restoreChain: Promise<void> = Promise.resolve()

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Library transaction failed.'))
  })
}
/** Reactive proxies (any object read out of a Svelte $state store) cannot be structured-cloned
 * into IndexedDB — the row write rejects with "could not be cloned" and every save after it
 * reports the storage-error banner. Plain values keep their identity so the flush diff still
 * skips unchanged rows; only un-cloneable reactive trees are replaced by a plain JSON snapshot. */
function plainRowValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  try {
    structuredClone(value)
    return value
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}
function database(): Promise<IDBDatabase> {
  return connection ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('collections')
      req.result.createObjectStore('records').createIndex('collection', 'collection')
    }
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); connection = undefined }
      resolve(req.result)
    }
    req.onerror = () => { connection = undefined; reject(req.error) }
    req.onblocked = () => reject(new Error('Close other Izumi windows to open the library database.'))
  })
}
async function readRows(collection: string): Promise<Rows | null> {
  const db = await database()
  const tx = db.transaction(['collections', 'records'])
  const done = completed(tx)
  const [exists, records] = await Promise.all([
    request(tx.objectStore('collections').get(collection)),
    request(tx.objectStore('records').index('collection').getAll(collection)),
    done,
  ])
  return exists ? new Map(records.map(row => [row.id, row.value])) : null
}
async function patchRows(collection: string, previous: Rows, next: Rows): Promise<void> {
  const db = await database()
  const tx = db.transaction(['collections', 'records'], 'readwrite')
  const done = completed(tx)
  const records = tx.objectStore('records')
  try {
    for (const id of previous.keys()) if (!next.has(id)) records.delete([collection, id])
    for (const [id, value] of next) {
      if (!previous.has(id) || previous.get(id) !== value) records.put({ collection, id, value: plainRowValue(value) }, [collection, id])
    }
    tx.objectStore('collections').put(true, collection)
  } catch (cause) {
    tx.abort()
    await done.catch(() => {})
    throw cause
  }
  await done
}

export const mapCodec = <T>(): StateCodec<Record<string, T>> => ({
  encode: value => new Map(Object.entries(value)),
  decode: rows => Object.fromEntries(rows) as Record<string, T>,
})

/** Map-valued fields (entries and tombstones) get one row per entry; ordered arrays and scalar
 * metadata retain their exact representation. Field names never collide with media keys. */
export const objectCodec = <T extends object>(initial: T): StateCodec<T> => ({
  encode(value) {
    const rows: Rows = new Map()
    for (const [field, item] of Object.entries(value)) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.set(JSON.stringify([field]), MAP_FIELD)
        for (const [id, entry] of Object.entries(item)) rows.set(JSON.stringify([field, id]), entry)
      } else rows.set(JSON.stringify([field]), item)
    }
    return rows
  },
  decode(rows) {
    const value = Object.assign(Object.create(null), initial) as Record<string, unknown>
    for (const [key, item] of rows) {
      const [field, id] = JSON.parse(key) as string[]
      if (id === undefined) value[field] = item && typeof item === 'object' && !Array.isArray(item) && (item as { map?: boolean }).map === true ? Object.create(null) : item
    }
    for (const [key, item] of rows) {
      const [field, id] = JSON.parse(key) as string[]
      if (id !== undefined) (value[field] as Record<string, unknown>)[id] = item
    }
    return value as T
  },
})

export function databasePersisted<T>(collection: string, initial: T, codec: StateCodec<T>): DatabaseStore<T> {
  const existing = stores.get(collection)
  if (existing) return existing as DatabaseStore<T>
  let current = initial
  let legacy: string | null = null
  // The server/test runtime has no disk. Browser failures are surfaced, never treated as an empty
  // successful migration. Keep the old value until its database transaction has committed.
  const available = typeof indexedDB !== 'undefined'
  if (typeof localStorage !== 'undefined') {
    legacy = localStorage.getItem(collection)
    if (legacy != null) current = JSON.parse(legacy) as T
  }
  const memory = writable(current)
  const legacyInitial = current
  let loaded = !available
  let saved = codec.encode(current)
  let pending: Array<(value: T) => T> = []
  let saving: Promise<void> | undefined
  let revision = 0
  let savedRevision = 0
  const report = (cause: unknown) => {
    libraryStorageError.set(`Could not save your library: ${cause instanceof Error ? cause.message : String(cause)}. Keep Izumi open and export a backup before restarting.`)
  }
  const ready = available ? (async () => {
    const rows = await readRows(collection)
    let hydrated = rows == null || legacy != null ? legacyInitial : codec.decode(rows)
    saved = codec.encode(hydrated)
    if (rows == null || legacy != null) {
      await patchRows(collection, rows ?? new Map(), saved)
      if (legacy != null && localStorage.getItem(collection) === legacy) localStorage.removeItem(collection)
    }
    // Includes edits made while the migration transaction itself was committing.
    for (const update of pending) hydrated = update(hydrated)
    current = hydrated
    loaded = true
    pending = []
    memory.set(current)
    if (revision) await flush()
  })() : Promise.resolve()
  // Attach a handler immediately; callers still receive the rejection from `ready` and `flush`.
  void ready.catch(report)

  async function flush(): Promise<void> {
    if (!available) return
    if (restoreBarrier) await restoreBarrier
    if (!loaded) await ready
    if (saving) { await saving; if (savedRevision !== revision) return flush(); return }
    if (savedRevision === revision) return
    saving = (async () => {
      while (savedRevision !== revision) {
        const target = revision
        const next = codec.encode(current)
        await patchRows(collection, saved, next)
        saved = next
        savedRevision = target
      }
    })()
    try { await saving } catch (cause) { report(cause); throw cause } finally { saving = undefined }
  }
  const update = (fn: (value: T) => T) => {
    const next = fn(current)
    if (next === current) return
    if (!loaded) pending.push(fn)
    current = next
    revision++
    memory.set(current)
    if (loaded) void flush().catch(() => {})
  }
  const result: DatabaseStore<T> = {
    subscribe: memory.subscribe, set: value => update(() => value), update, ready, flush,
    acceptRestored(value) {
      current = value
      saved = codec.encode(value)
      savedRevision = ++revision
      memory.set(value)
    },
  }
  stores.set(collection, result as DatabaseStore<unknown>)
  return result
}

export async function flushLibraryStorage(): Promise<void> {
  await Promise.all([...stores.values()].map(store => store.flush()))
  libraryStorageError.set('')
}
export async function libraryStorageReady(): Promise<void> {
  await Promise.all([...stores.values()].map(store => store.ready))
}
export function isLibraryCollection(key: string): boolean {
  return /^(?:izumi-profile:[A-Za-z0-9_-]{1,100}:)?(?:local-history|local-media-library-v1)$/.test(key)
}

/** Backup every profile, including those never opened in this process. Keep legacy backup keys
 * on export so older JSON backups remain readable and new backups remain portable. */
export async function exportLibraryStorage(): Promise<Record<string, string>> {
  await libraryStorageReady()
  // A full disk must not prevent rescuing the unsaved in-memory changes in an exported file.
  await flushLibraryStorage().catch(() => {})
  if (typeof indexedDB === 'undefined') return {}
  const db = await database()
  const collections = await request(db.transaction('collections').objectStore('collections').getAllKeys())
  const values: Record<string, string> = {}
  for (const key of collections.map(String).filter(isLibraryCollection)) {
    const codec = key.endsWith(':local-history') || key === 'local-history' ? mapCodec() : objectCodec({})
    values[key] = JSON.stringify(codec.decode(await readRows(key) ?? new Map()))
  }
  for (const [key, store] of stores) if (isLibraryCollection(key)) values[key] = JSON.stringify(get(store))
  return values
}

/** One transaction for all restored collections. No localStorage quota is charged for library
 * records, including when importing a legacy application backup. Caller reloads after success. */
export function restoreLibraryStorage(values: Record<string, string>): Promise<void> {
  const result = restoreChain.catch(() => {}).then(() => restoreCollections(values))
  restoreChain = result
  return result
}

async function restoreCollections(values: Record<string, string>): Promise<void> {
  await flushLibraryStorage()
  const decoded = Object.entries(values).filter(([key]) => isLibraryCollection(key)).map(([key, text]) => {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid library data in backup.')
    const codec = key.endsWith(':local-history') || key === 'local-history' ? mapCodec() : objectCodec({})
    return [key, codec.encode(value)] as const
  })
  if (!decoded.length) return
  let release!: () => void
  restoreBarrier = new Promise<void>(resolve => { release = resolve })
  try {
    const db = await database()
    const tx = db.transaction(['collections', 'records'], 'readwrite')
    const done = completed(tx)
    const records = tx.objectStore('records')
    let writeError: unknown
    try {
      for (const [collection, rows] of decoded) {
        const keys = records.index('collection').getAllKeys(collection)
        keys.onsuccess = () => {
          try {
            for (const key of keys.result) records.delete(key)
            for (const [id, value] of rows) records.put({ collection, id, value }, [collection, id])
          } catch (cause) { writeError = cause; tx.abort() }
        }
        tx.objectStore('collections').put(true, collection)
      }
      await done
    } catch (cause) {
      // Synchronous put()/clone/quota errors must also abort already queued deletions. Waiting
      // for the abort prevents a later request callback from committing after Restore failed.
      try { tx.abort() } catch { /* already completed or aborted */ }
      await done.catch(() => {})
      throw writeError ?? cause
    }
    for (const [key, text] of Object.entries(values)) stores.get(key)?.acceptRestored(JSON.parse(text))
  } finally {
    restoreBarrier = undefined
    release()
  }
}

export async function deleteLibraryProfile(profileId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const prefix = `izumi-profile:${profileId}:`
  const db = await database()
  const tx = db.transaction(['collections', 'records'], 'readwrite')
  const done = completed(tx)
  const collections = tx.objectStore('collections')
  const keys = collections.getAllKeys()
  keys.onsuccess = () => {
    for (const collection of keys.result.map(String).filter(key => key.startsWith(prefix))) {
      collections.delete(collection)
      const rows = tx.objectStore('records').index('collection').getAllKeys(collection)
      rows.onsuccess = () => { for (const key of rows.result) tx.objectStore('records').delete(key) }
    }
  }
  await done
}
