import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('production developer tools', () => {
  const page = read('./+page.svelte')
  const cargo = read('../../../../../src-tauri/Cargo.toml')
  const native = read('../../../../../src-tauri/src/lib.rs')

  it('ships the desktop inspector feature and exposes it through an explicit settings action', () => {
    expect(cargo).toContain('tauri = { version = "2", features = ["devtools"] }')
    expect(native).toContain('fn open_developer_tools(window: tauri::WebviewWindow)')
    expect(native).toContain('window.open_devtools();')
    expect(page).toContain("await invoke('open_developer_tools')")
    expect(page).toContain('Open developer tools')
  })

  it('includes the inspector in shipped macOS builds', () => {
    expect(cargo).toContain("[target.'cfg(not(target_os = \"android\"))'.dependencies]")
    expect(native).toContain('#[cfg(not(target_os = "android"))]')
    expect(native).toContain('window.open_devtools();')
  })

  it('keeps the action off Android and warns before users share network logs', () => {
    expect(page).toContain('{#if !$isAndroid}')
    expect(page).toContain('signed links or account tokens')
  })
})
