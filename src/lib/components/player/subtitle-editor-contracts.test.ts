import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const editor = read('./SubtitleEditor.svelte')
const desktop = read('./PlayerOverlay.svelte')
const controls = read('./Controls.svelte')
const android = read('./AndroidPlayer.svelte')
const androidBridge = read('../../player/android-mpv.ts')
const nativeBridge = read('../../player/native.ts')
const rust = read('../../../../src-tauri/src/lib.rs')
const plugin = read('../../../../src-tauri/tauri-plugin-mpv/src/lib.rs')
const pluginDefault = read('../../../../src-tauri/tauri-plugin-mpv/permissions/default.toml')
const kotlin = read('../../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt')

describe('subtitle editor cross-platform contract', () => {
  it('freezes playback, captures a private frame, and preserves the prior pause state', () => {
    expect(editor).toContain("await safeCommand('set', ['pause', 'yes'])")
    expect(editor).toContain('const frame = await capture()')
    expect(editor).toContain('if (resumeAfter) await safeCommand')
    expect(editor).toContain('subtitleStyleEnabled.set(true)')
  })
  it('is reachable from desktop and Game Mode player settings', () => {
    expect(controls).toContain('Edit subtitle position &amp; size…')
    expect(controls).toContain('<span>Edit subtitles</span>')
    expect(desktop).toContain('playerEditorSnapshot(pos)')
    expect(desktop).toContain('<SubtitleEditor')
  })
  it('waits for live desktop style commands and keeps editor actions clear of window controls', () => {
    expect(desktop).toContain('return playerCommand(name, args).catch')
    expect(editor).toContain('Reset to the original subtitle style')
    expect(editor).toContain("<span class=\"hidden sm:inline\">Position</span><span>{Math.round(position)}%</span>")
    expect(editor).toContain('w-[8.25rem] shrink-0')
  })
  it('is reachable from Android player settings and uses the live-core snapshot', () => {
    expect(android).toContain('Edit position &amp; size')
    expect(android).toContain('capture={grabCurrentFrame}')
    expect(androidBridge).toContain("invoke('plugin:mpv|mpv_snapshot')")
  })
  it('registers temporary-frame capture on desktop and Android', () => {
    expect(nativeBridge).toContain("invoke('player_editor_snapshot')")
    expect(rust).toContain('async fn player_editor_snapshot(')
    expect(plugin).toContain('commands::mpv_snapshot')
    expect(pluginDefault).toContain('allow-mpv-snapshot')
    expect(kotlin).toContain('fun snapshot(invoke: Invoke)')
    expect(kotlin).toContain('file.delete()')
  })
})
