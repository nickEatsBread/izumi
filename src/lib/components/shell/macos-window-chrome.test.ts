import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = '../../../../'
const native = readFileSync(fileURLToPath(new URL(`${root}src-tauri/src/lib.rs`, import.meta.url)), 'utf8')
const titlebar = readFileSync(fileURLToPath(new URL('./Titlebar.svelte', import.meta.url)), 'utf8')

describe('macOS window chrome', () => {
  it('keeps native traffic lights over a transparent titlebar', () => {
    expect(native).toContain('.title_bar_style(tauri::TitleBarStyle::Overlay)')
    expect(native).toContain('.traffic_light_position(tauri::LogicalPosition::new(12.0, 10.0))')
    expect(titlebar).toContain('{#if !$isMacOS}')
  })

  it('does not restore corrupted frameless macOS sizes', () => {
    expect(native).toContain('let window_state_flags = tauri_plugin_window_state::StateFlags::POSITION;')
    expect(native).toContain('.min_inner_size(900.0, 560.0)')
  })
})
