import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopPlayer = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/src/player/mod.rs',
  import.meta.url,
)), 'utf8').replace(/\r\n/g, '\n')

describe('desktop mpv frame captures', () => {
  it('never force software screenshots, which write nothing under hardware decoding on the Deck', () => {
    expect(desktopPlayer).not.toContain('set_property("screenshot-sw", "yes")')
    expect(desktopPlayer).toContain('let _ = mpv.set_property("screenshot-sw", "no");\n    let result = capture();')
  })

  it('puts the borrowed screenshot properties back so user screenshots stay PNG', () => {
    expect(desktopPlayer).toContain('let format = mpv.get_property::<String>("screenshot-format").ok();')
    expect(desktopPlayer).toContain('let _ = mpv.set_property("screenshot-format", format.as_str());')
    expect(desktopPlayer).toContain('let _ = mpv.set_property("screenshot-jpeg-quality", prior_quality);')
    expect(desktopPlayer).toContain('let _ = mpv.set_property("screenshot-sw", software.as_str());')
  })

  it('routes the subtitle editor still and the GIF recorder through it with their own modes', () => {
    expect(desktopPlayer).toContain('with_jpeg_screenshots(mpv, 90, || {\n            mpv.command("screenshot-to-file", &[path, "video"])')
    expect(desktopPlayer).toContain('with_jpeg_screenshots(&client, 92, || {')
    expect(desktopPlayer).toContain('.command("screenshot-to-file", &[path.as_str(), screenshot_mode])')
    expect(desktopPlayer).toMatch(/let screenshot_mode = if include_subtitles \{\s*"subtitles"\s*\} else \{\s*"video"\s*\};/)
  })
})
