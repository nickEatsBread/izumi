import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const surface = readFileSync('src/lib/components/player/DrmSurface.svelte', 'utf8')
const native = readFileSync('src-tauri/src/lib.rs', 'utf8')

describe('concurrent GIF processing', () => {
  it('serializes compositor shutdown without waiting for background encoding', () => {
    const start = surface.slice(surface.indexOf('async function gifStart'), surface.indexOf('async function gifStop'))
    const stop = surface.slice(surface.indexOf('async function gifStop'), surface.indexOf('async function gifAbort'))
    expect(start).toContain('if (gifStopping) await gifStopping.catch(() => {})')
    expect(stop).toContain('gifStopping = task')
    expect(stop.indexOf("await invoke('drm_gif_stop')")).toBeLessThan(stop.indexOf('await finishGifUi()'))
  })

  it('frees the recorder before detaching each independent encoder', () => {
    const stop = native.slice(native.indexOf('async fn drm_gif_stop'), native.indexOf('/// Encode a bounded segment'))
    expect(stop.indexOf('.take()')).toBeLessThan(stop.indexOf('join.await'))
    expect(stop.indexOf('join.await')).toBeLessThan(stop.indexOf('tauri::async_runtime::spawn(async move'))
    expect(stop).toContain('encode_gif_frames(&app, &frames).await')
    expect(stop).toContain('remove_dir_all(&frames.dir)')
  })
})
