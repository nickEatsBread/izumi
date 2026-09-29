import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readPatchBlock } from './librqbit-vendor.mjs'

// src-tauri/Cargo.toml patches librqbit, and the crates it needs from the same upstream
// repositories, with the copies scripts/ci/librqbit-vendor.mjs writes to src-tauri/vendor. When a
// dependency bump needs other versions of them, Cargo drops the patch with nothing but a warning
// and izumi silently builds the crates.io code, without izumi's patches. See
// src-tauri/vendor/README.md.
const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/\r\n/g, '\n')
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8').replace(/\r\n/g, '\n')
const lockedPackages = cargoLock.split('\n[[package]]\n').slice(1)
const pins = JSON.parse(readFileSync('src-tauri/vendor/upstream.json', 'utf8'))
const vendored = readPatchBlock(cargoToml)

describe('vendored librqbit crates', () => {
  it('lists the same crates in Cargo.toml and upstream.json', () => {
    expect(vendored).toEqual(pins.vendored)
  })

  it.each(vendored)('%s resolves to src-tauri/vendor', (name) => {
    const entries = lockedPackages.filter((entry) => entry.startsWith(`name = "${name}"\n`))
    expect(entries, `${name} is locked exactly once`).toHaveLength(1)
    // A path dependency has no source line. A registry source means the patch went unused.
    expect(entries[0], `${name} comes from crates.io, not the vendored copy`).not.toMatch(/^source = /m)
  })

  it('leaves no patch unused', () => {
    expect(cargoLock).not.toContain('[[patch.unused]]')
  })

  it('has a directory for each vendored crate and none left over', () => {
    const dirs = readdirSync('src-tauri/vendor').filter((name) => existsSync(`src-tauri/vendor/${name}/Cargo.toml`))
    expect(dirs.sort()).toEqual([...vendored].sort())
  })

  it("vendors each repository's root crate while izumi has patches for it", () => {
    for (const key of Object.keys(pins.repos)) {
      const dir = `src-tauri/vendor/patches/${key}`
      const patches = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.patch')) : []
      if (key === pins.rootRepo && patches.length) expect(vendored).toContain(pins.root)
    }
  })
})
