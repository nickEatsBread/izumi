import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface LockedNpmPackage {
  version?: string
}

const npmPackages = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages as Record<string, LockedNpmPackage>
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8')
const rustPlugins = new Map(
  [...cargoLock.matchAll(/\[\[package\]\]\r?\nname = "(tauri-plugin-[^"]+)"\r?\nversion = "([^"]+)"/g)]
    .map((match) => [match[1], match[2]] as const),
)

const releaseLine = (version: string) => version.split('.').slice(0, 2).join('.')

describe('Tauri package alignment', () => {
  it('keeps JavaScript and Rust plugins on the same major/minor release line', () => {
    let compared = 0
    for (const [path, npmPackage] of Object.entries(npmPackages)) {
      const prefix = 'node_modules/@tauri-apps/plugin-'
      if (!path.startsWith(prefix) || !npmPackage.version) continue
      const npmName = path.slice('node_modules/'.length)
      const rustName = npmName.replace('@tauri-apps/plugin-', 'tauri-plugin-')
      const rustVersion = rustPlugins.get(rustName)
      if (!rustVersion) continue
      compared += 1
      expect(
        releaseLine(rustVersion),
        `${npmName} ${npmPackage.version} must match ${rustName} ${rustVersion}`,
      ).toBe(releaseLine(npmPackage.version))
    }
    expect(compared).toBeGreaterThan(0)
  })
})
