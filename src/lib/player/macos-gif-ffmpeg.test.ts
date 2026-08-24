import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8').replaceAll('\r\n', '\n')
const rust = read(new URL('../../../src-tauri/src/lib.rs', import.meta.url))
const release = read(new URL('../../../.github/workflows/release.yml', import.meta.url))

describe('macOS GIF encoder packaging', () => {
  it('prefers the app-bundled ffmpeg when no explicit override is configured', () => {
    expect(rust).toContain('fn capture_ffmpeg_executable(_app: &AppHandle)')
    expect(rust).toContain('resources.join("ffmpeg")')
    expect(rust).toContain('capture_ffmpeg_command(\n        &executable,')
    expect(rust).toContain('gif_frames_ffmpeg(&executable')
  })

  it('builds and verifies a relocatable ffmpeg in the macOS app resources', () => {
    expect(release).toContain('dylibbundler -of -b -x "$TOOL"')
    expect(release).toContain('macos-tools/ffmpeg')
    expect(release).toContain('Verify bundled macOS GIF encoder')
    expect(release).toContain("Bundled ffmpeg still references Homebrew")
  })
})
