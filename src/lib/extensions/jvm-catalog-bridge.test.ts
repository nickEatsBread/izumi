import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manager = readFileSync(fileURLToPath(new URL('./manager.ts', import.meta.url)), 'utf8')
const android = readFileSync(fileURLToPath(new URL('../../../src-tauri/tauri-plugin-extplayer/android/src/main/java/app/izumi/extplayer/ExtPlayerPlugin.kt', import.meta.url)), 'utf8')

describe('JVM catalog bridge', () => {
  it('exposes browsing through the shared desktop command', () => {
    expect(manager).toContain("method: 'getPopular' | 'getLatestUpdates' | 'search'")
    expect(manager).toContain("jvmInvoke<Record<string, unknown>>('getDetail'")
  })

  it('dispatches popular and latest calls through the Android runtime host', () => {
    expect(android).toContain('"getPopular" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiGetPopular"')
    expect(android).toContain('"getLatestUpdates" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiGetLatestUpdates"')
  })
})
