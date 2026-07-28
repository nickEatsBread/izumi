import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'

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
