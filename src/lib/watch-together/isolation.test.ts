import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const client = readFileSync(fileURLToPath(new URL('./client.ts', import.meta.url)), 'utf8')
const nativeSync = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/sync.rs', import.meta.url)), 'utf8')

describe('Watch Together transport isolation', () => {
  it('does not call Device Sync commands or require pairing', () => {
    expect(client).not.toContain("'sync_write'")
    expect(client).not.toContain("'sync_read'")
    expect(client).not.toContain('getSyncStatus')
    expect(client).not.toContain('paired')
  })

  it('does not allow room records in the persistent sync document', () => {
    const categories = nativeSync.match(/const VALID_CATEGORIES[^;]+;/)?.[0] ?? ''
    expect(categories).not.toContain('watch-party')
  })
})
