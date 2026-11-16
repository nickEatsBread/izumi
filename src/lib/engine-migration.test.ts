import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ file: null as string | null, invoke: vi.fn() }))
const library = vi.hoisted(() => ({
  exportLibraryStorage: vi.fn(async () => ({ 'local-history': '{"db":1}' })),
  restoreLibraryStorage: vi.fn(async () => {}),
  isLibraryCollection: (key: string) => key === 'local-history',
}))
const os = vi.hoisted(() => ({ platform: vi.fn(() => 'linux') }))
const win = vi.hoisted(() => ({ onCloseRequested: vi.fn(async (_handler: () => Promise<unknown>) => () => {}) }))
const boot = vi.hoisted(() => ({ scheduleBootWork: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/plugin-os', () => os)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))
vi.mock('$lib/util/boot-work', () => boot)
vi.mock('$lib/storage/library-db', () => library)

import {
  buildEngineMigration, ENGINE_MIGRATED_KEY, importEngineMigration, startEngineMigrationWriter, writeEngineMigration,
} from './engine-migration'

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
  native.invoke.mockReset().mockImplementation(async (command: string, args?: { json: string }) => {
    if (command === 'engine_migration_write') native.file = args!.json
    if (command === 'engine_migration_take') return native.file
    if (command === 'engine_migration_done') native.file = null
    return null
  })
  library.restoreLibraryStorage.mockClear()
  os.platform.mockReset().mockReturnValue('linux')
  win.onCloseRequested.mockClear()
  boot.scheduleBootWork.mockClear()
  vi.unstubAllGlobals()
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

describe('WebKitGTK writer', () => {
  it('writes JSON the CEF build imports', async () => {
    const webkit = new MemoryStorage()
    webkit.setItem('anilist-token', '"secret"')
    webkit.setItem('izumi-reset-requested', '1')
    await writeEngineMigration(webkit)
    expect(native.invoke).toHaveBeenCalledWith('engine_migration_write', { json: expect.any(String) })

    const cef = new MemoryStorage()
    expect(await importEngineMigration(cef)).toBe(true)
    expect(cef.getItem('anilist-token')).toBe('"secret"')
    expect(cef.getItem('izumi-reset-requested')).toBeNull()
    expect(library.restoreLibraryStorage).toHaveBeenCalledWith(expect.objectContaining({ 'local-history': '{"db":1}' }))
  })

  it('still lets the window close when the write fails', async () => {
    native.invoke.mockRejectedValue(new Error('disk full'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = startEngineMigrationWriter(new MemoryStorage())
    expect(boot.scheduleBootWork).toHaveBeenCalledOnce()
    await expect(win.onCloseRequested.mock.calls[0][0]()).resolves.toBeUndefined()
    stop()
  })

  it('stays off on the Chromium build and off Linux', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })
    startEngineMigrationWriter(new MemoryStorage())()
    vi.unstubAllGlobals()
    os.platform.mockReturnValue('windows')
    startEngineMigrationWriter(new MemoryStorage())()
    expect(boot.scheduleBootWork).not.toHaveBeenCalled()
    expect(win.onCloseRequested).not.toHaveBeenCalled()
  })
})
