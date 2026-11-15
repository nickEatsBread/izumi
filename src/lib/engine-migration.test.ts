import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ file: null as string | null, invoke: vi.fn() }))
const library = vi.hoisted(() => ({
  exportLibraryStorage: vi.fn(async () => ({ 'local-history': '{"db":1}' })),
  restoreLibraryStorage: vi.fn(async () => {}),
  isLibraryCollection: (key: string) => key === 'local-history',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('$lib/storage/library-db', () => library)

import { buildEngineMigration, ENGINE_MIGRATED_KEY, importEngineMigration } from './engine-migration'

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
  native.file = null
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'engine_migration_take') return native.file
    if (command === 'engine_migration_done') native.file = null
    return null
  })
  library.restoreLibraryStorage.mockClear()
})

describe('WebKitGTK to CEF engine migration', () => {
  it('moves secrets and device keys but never transient ones', async () => {
    const webkit = new MemoryStorage()
    webkit.setItem('anilist-token', '"secret"')
    webkit.setItem('nav-config-v1', '[]')
    webkit.setItem('izumi-reset-requested', '1')
    native.file = JSON.stringify(await buildEngineMigration(webkit))

    const cef = new MemoryStorage()
    expect(await importEngineMigration(cef)).toBe(true)
    expect(cef.getItem('anilist-token')).toBe('"secret"')
    expect(cef.getItem('nav-config-v1')).toBe('[]')
    expect(cef.getItem('izumi-reset-requested')).toBeNull()
    expect(cef.getItem('local-history')).toBeNull()
    expect(library.restoreLibraryStorage).toHaveBeenCalledWith(expect.objectContaining({ 'local-history': '{"db":1}' }))
    expect(cef.getItem(ENGINE_MIGRATED_KEY)).not.toBeNull()
    expect(native.file).toBeNull()
  })

  it('imports once, and does nothing without a file', async () => {
    const cef = new MemoryStorage()
    expect(await importEngineMigration(cef)).toBe(false)
    native.file = JSON.stringify({ app: 'izumi', kind: 'engine-migration', version: 1, localStorage: { a: '1' } })
    cef.setItem(ENGINE_MIGRATED_KEY, '1')
    expect(await importEngineMigration(cef)).toBe(false)
    expect(cef.getItem('a')).toBeNull()
  })

  it('rejects a file that is not a migration', async () => {
    native.file = JSON.stringify({ app: 'izumi', kind: 'app-backup', version: 1, localStorage: {} })
    await expect(importEngineMigration(new MemoryStorage())).rejects.toThrow('Not an izumi engine migration.')
  })
})
