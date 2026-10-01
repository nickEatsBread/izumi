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
const playerRust = read('../../../../src-tauri/src/player/mod.rs')
const plugin = read('../../../../src-tauri/tauri-plugin-mpv/src/lib.rs')
const pluginDefault = read('../../../../src-tauri/tauri-plugin-mpv/permissions/default.toml')
const kotlin = read('../../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt')

describe('subtitle editor cross-platform contract', () => {
  it('freezes playback on a real line, moves it live, and preserves the prior pause state', () => {
    expect(editor).toContain("await safeCommand('set', ['pause', 'yes'])")
    expect(editor).toContain("getProperty('sub-text')")
    expect(editor).toContain("await safeCommand('sub-seek', ['1'])")
    expect(editor).toContain('if (resumeAfter) await safeCommand')
    expect(editor).toContain('sessionSubtitleAdjustments.update((current) => ({ ...current, position }))')
    // Closing without Save (X, Escape, or B unmounting it in Game Mode) puts the old position back.
    expect(editor).toContain('sessionSubtitleAdjustments.set(before)')
    expect(editor).not.toContain('subtitleStyleEnabled.set(true)')
    expect(editor).not.toContain('subtitleFont.set(')
    expect(editor).not.toContain('subtitleFontSize.set(')
  })
  it('is reachable from desktop and Game Mode player settings', () => {
    expect(controls).toContain('Subtitle position')
    expect(controls).toContain('Move up or down')
    expect(controls).toContain('<span>Move subtitles</span>')
    expect(desktop).toContain('getProperty={(name) => playerGetProperty(name)}')
    expect(desktop).toContain('<SubtitleEditor')
    expect(desktop).toContain('subtitleEditorOpen,')
    expect(desktop).toContain('onpaint={gmBitmapMode ? bumpPlayerOverlay : undefined}')
    expect(editor).toContain('data-nav-trap')
    expect(editor).toContain('onfocusin={requestPaint}')
    // The pad steps this slider through nav's shared adapter (padAdjust: snapped, clamped, `input`
    // then `change`), reached by one pad-marked arrow; the hand-rolled stepDown/stepUp is gone.
    expect(desktop).toContain('if (key) dispatchPadKey(key)')
    expect(desktop).not.toContain('active.stepDown()')
    expect(desktop).not.toContain('active.stepUp()')
  })
  it('applies through the live desktop command path and keeps editor actions clear of window controls', () => {
    expect(desktop).toContain('return playerCommand(name, args).catch')
    expect(editor).toContain('Reset to the original subtitle position')
    expect(editor).toContain('aria-label={`Subtitle position ${Math.round(position)} percent`}')
    expect(editor).toContain('w-[8.25rem] shrink-0')
  })
  it('is reachable from Android player settings and follows the selected track', () => {
    expect(android).toContain('Move subtitles')
    expect(android).toContain('getProperty={(name) => mpvGet(name)}')
    expect(kotlin).toContain('m.observeProperty("sid", MPVLib.MpvFormat.MPV_FORMAT_STRING)')
    expect(androidBridge).toContain("if (property === 'sid') return { ...s, sid: String(value ?? '') }")
  })
  it('re-reads the selected track on desktop whenever mpv switches it', () => {
    expect(playerRust).toContain('client.observe_property("sid", Format::String, 0)?;')
    expect(playerRust).toContain('app.emit("player-sub-track", sid.to_string())')
    expect(desktop).toContain("listen<string>('player-sub-track', () => { void readSubtitleTrack() })")
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
