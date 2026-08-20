import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { ioErrorMessage } from './player/history-io'

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('full application backup', () => {
  it('redacts secrets unless explicitly included', () => {
    const storage = new MemoryStorage()
    storage.setItem('nav-config-v1', '[]')
    storage.setItem('debrid-key', '"secret"')
    expect(createBackup(storage).localStorage).toEqual({ 'nav-config-v1': '[]' })
    expect(createBackup(storage, true).localStorage['debrid-key']).toBe('"secret"')
  })

  it('validates and restores values', () => {
    const storage = new MemoryStorage()
    const backup = parseBackup(JSON.stringify({
      app: 'izumi', kind: 'app-backup', version: 1, exportedAt: 1, includesSecrets: false,
      localStorage: { 'home-row-order': '["continue"]', 'extension-urls': '[]' },
    }))
    expect(restoreBackup(storage, backup)).toBe(2)
    expect(storage.getItem('home-row-order')).toBe('["continue"]')
  })
})

// "Save backup" went through @tauri-apps/plugin-dialog's save(), and the capability file granted
// dialog:allow-open but never dialog:allow-save. Tauri denies an ungranted command at the IPC
// boundary, so EVERY save dialog in the app — the application backup, both watch-history exports,
// and the diagnostics dump — rejected before a file picker could open. The denial arrives as a
// string, which the callers' `instanceof Error` checks discarded, so all the user saw was
// "Backup failed." Nothing about this is visible until someone presses the button, hence a test.
describe('save-dialog capability', () => {
  const capability = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
  ) as { permissions: unknown[] }

  it('grants both halves of the file-dialog plugin', () => {
    expect(capability.permissions).toContain('dialog:allow-open')
    expect(capability.permissions).toContain('dialog:allow-save')
  })
})

// Android's save picker returns a `content://` URI. Writing that with std::fs is
// "os error 2" (ENOENT) because the URI is not a filesystem path. The native write
// primitive has to send those URIs through ContentResolver.openOutputStream so the
// user can put the backup anywhere the system picker allows.
describe('Android backup save', () => {
  const rust = readFileSync(
    fileURLToPath(new URL('../../src-tauri/src/text_file.rs', import.meta.url)),
    'utf8',
  )
  const helper = readFileSync(
    fileURLToPath(new URL('./player/history-io.ts', import.meta.url)),
    'utf8',
  )

  it('keeps the save-dialog result as the write destination', () => {
    expect(helper).toMatch(/const path = await save\(/)
    expect(helper).toMatch(/invoke\('write_text_file',\s*\{\s*path,\s*contents\s*\}/)
  })

  it('writes content:// URIs through ContentResolver instead of std::fs', () => {
    expect(rust).toMatch(/starts_with\("content:"\)/)
    expect(rust).toContain('openOutputStream')
    expect(rust).toContain('ContentResolver')
  })
})

describe('ioErrorMessage', () => {
  it('surfaces a Tauri string rejection instead of the generic fallback', () => {
    expect(ioErrorMessage('dialog.save not allowed', 'Backup failed.')).toBe('dialog.save not allowed')
    expect(ioErrorMessage(new Error('Disk full'), 'Backup failed.')).toBe('Disk full')
  })

  it('falls back for values that say nothing', () => {
    expect(ioErrorMessage('   ', 'Backup failed.')).toBe('Backup failed.')
    expect(ioErrorMessage(undefined, 'Backup failed.')).toBe('Backup failed.')
    expect(ioErrorMessage(new Error(''), 'Backup failed.')).toBe('Backup failed.')
  })
})
