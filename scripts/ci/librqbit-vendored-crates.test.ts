import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// src-tauri/Cargo.toml patches librqbit's DHT and uTP crates with the copies in src-tauri/vendor.
// When a librqbit bump needs newer versions of them, Cargo drops the patch with nothing but a
// warning and the Windows fix silently disappears. See src-tauri/vendor/README.md.
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8').replace(/\r\n/g, '\n')
const lockedPackages = cargoLock.split('\n[[package]]\n').slice(1)

describe('vendored librqbit crates', () => {
  it.each(['librqbit-dht', 'librqbit-utp'])('%s resolves to src-tauri/vendor', (name) => {
    const entries = lockedPackages.filter((entry) => entry.startsWith(`name = "${name}"\n`))
    expect(entries, `${name} is locked exactly once`).toHaveLength(1)
    // A path dependency has no source line. A registry source means the patch went unused.
    expect(entries[0], `${name} comes from crates.io, not the vendored copy`).not.toMatch(/^source = /m)
  })

  it('leaves no patch unused', () => {
    expect(cargoLock).not.toContain('[[patch.unused]]')
  })
})
