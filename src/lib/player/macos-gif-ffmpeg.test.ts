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
    expect(rust).toMatch(/gif_frames_ffmpeg\(\s*&executable,/)
  })

  it('reports a signal-killed encoder as unavailable instead of a generic failure', () => {
    // macOS SIGKILLs a binary whose ad-hoc signature was invalidated after signing; the child
    // then exits with no stderr, which used to read as an opaque "GIF recording failed".
    expect(rust).toContain('if output.status.code().is_none() {')
    expect(rust.indexOf('output.status.code().is_none()')).toBeLessThan(rust.indexOf('capture-failed:'))
  })

  it('builds, re-signs, and verifies a relocatable ffmpeg in the macOS app resources', () => {
    expect(release).toContain('dylibbundler -of -b -x "$TOOL"')
    expect(release).toContain('macos-tools/ffmpeg')
    // dylibbundler + install_name_tool rewrite load commands after Homebrew's ad-hoc signature;
    // CI runners run with SIP disabled so only an explicit verify catches the broken seal.
    const toolIndex = release.indexOf('install_name_tool -add_rpath "@executable_path/../Frameworks" "$TOOL"')
    expect(toolIndex).toBeGreaterThan(-1)
    expect(release.indexOf('codesign --force --sign - "$TOOL"')).toBeGreaterThan(toolIndex)
    expect(release).toContain('codesign --verify --strict "$FFMPEG"')
    expect(release).toContain('Verify bundled macOS GIF encoder')
    expect(release).toContain("Bundled ffmpeg still references Homebrew")
  })
})
