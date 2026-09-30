import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const session = readFileSync('src/lib/player/session.ts', 'utf8')
const surface = readFileSync('src/lib/components/player/DrmSurface.svelte', 'utf8')
const contract = readFileSync('src/lib/player/drm.ts', 'utf8')

describe('capture-safe picture in picture transitions', () => {
  it('waits for screenshots and drains active GIF capture before viewport changes', () => {
    const prepare = surface.slice(
      surface.indexOf('async function prepareForViewportChange'),
      surface.indexOf('const thumbCache'),
    )
    expect(contract).toContain('prepareForViewportChange?: () => Promise<boolean>')
    expect(prepare).toContain('if (screenshotTask) await screenshotTask.catch(() => {})')
    expect(prepare).toContain('if (gifBoot) await gifBoot.catch(() => {})')
    expect(prepare).toContain('await gifStop()')
  })

  it('lets the miniplayer be resized from its edges below the browse window minimum', () => {
    // The OS applies a window's minimum to the user's edge drags (not to set_size), so the 480×300
    // miniplayer snapped to the browse window's 900×560 on the first drag.
    const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const pip = native.slice(native.indexOf('fn player_toggle_pip('), native.indexOf('fn player_command('))
    expect(native).toContain('const PIP_MIN_SIZE: (f64, f64) = (320.0, 180.0);')
    const enter = pip.slice(pip.indexOf('let snapshot = PipSnapshot {'))
    expect(enter.indexOf('set_min_size(Some(tauri::LogicalSize::new(PIP_MIN_SIZE.0, PIP_MIN_SIZE.1)))')).toBeGreaterThan(-1)
    expect(enter.indexOf('set_min_size(Some(tauri::LogicalSize::new(PIP_MIN_SIZE.0, PIP_MIN_SIZE.1)))')).toBeLessThan(enter.indexOf('.set_size(tauri::LogicalSize::new(480.0, 300.0))'))
    // Leaving restores the browse minimum before the window is maximized or resized back.
    const exit = pip.slice(pip.indexOf('if let Some(snapshot) = saved.take()'), pip.indexOf('let snapshot = PipSnapshot {'))
    expect(exit.indexOf('set_min_size(Some(tauri::LogicalSize::new(MAIN_MIN_SIZE.0, MAIN_MIN_SIZE.1)))')).toBeGreaterThan(-1)
    expect(exit.indexOf('set_min_size(Some(tauri::LogicalSize::new(MAIN_MIN_SIZE.0, MAIN_MIN_SIZE.1)))')).toBeLessThan(exit.indexOf('window.maximize()'))
  })

  it('serializes rapid PiP toggles and clears a GIF indicator after handing off encoding', () => {
    expect(session).toContain('let pipTransition: Promise<void> = Promise.resolve()')
    expect(session).toContain('pipTransition.catch(() => {}).then(operation)')
    expect(session).toContain('await engine.prepareForViewportChange()')
    expect(session).toContain("playerNotice.set('Saving GIF in background…')")
    expect(session).toContain('return queuePipTransition(async () => {')
  })
})
