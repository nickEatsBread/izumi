import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('Android release hardening', () => {
  const ci = read('../../../.github/workflows/ci.yml')
  const preview = read('../../../.github/workflows/pr-build.yml')
  const release = read('../../../.github/workflows/release.yml')
  const scaffold = read('../../../scripts/ci/android-scaffold.sh')
  const verifyNative = read('../../../scripts/ci/verify-android-native.sh')
  const libmpvBuild = read('../../../scripts/ci/libmpv-android.sh')
  const mpvGradle = read('../../../src-tauri/tauri-plugin-mpv/android/build.gradle.kts')

  it('builds every Android path with NDK r28 or newer', () => {
    for (const workflow of [ci, preview, release]) {
      expect(workflow).not.toContain('NDK_VERSION: "27.')
      expect(workflow).toContain('NDK_VERSION: "29.0.14206865"')
    }
  })

  it('pins target SDK 36 and verifies edge-to-edge handling', () => {
    expect(scaffold).toContain("s/compileSdk = [0-9]+/compileSdk = 36/")
    expect(scaffold).toContain("s/targetSdk = [0-9]+/targetSdk = 36/")
    expect(scaffold).toContain('enableEdgeToEdge()')
  })

  it('aligns APK entries to 16 KiB and verifies every ELF LOAD segment', () => {
    for (const workflow of [preview, release]) {
      expect(workflow).toContain('zipalign" -f -P 16 4')
      expect(workflow).toContain('verify-android-native.sh')
      expect(workflow).not.toContain('zipalign" -f -p 4')
    }
    expect(verifyNative).toContain('ZIPALIGN" -c -P 16 -v 4')
    expect(verifyNative).toContain('alignment < 0x4000')
    expect(release).toContain('needs: [create-release, build, android, cleanup-release-signatures]')
  })

  it('builds the shipped player from the libass 0.17.5 source pin', () => {
    expect(libmpvBuild).toContain('f77f62c316c6b222e75ece48e1fbf1e798fd83e7')
    expect(libmpvBuild).toContain("grep -q '^v_libass=0\\.17\\.5$'")
    expect(libmpvBuild).toContain("grep 'commit: 0\\.17\\.5-'")
    expect(preview).toContain('Build libmpv with libass 0.17.5')
    expect(release).toContain('Build libmpv with libass 0.17.5')
    expect(scaffold).toContain('secure libmpv AAR missing')
    expect(scaffold).toContain("grep 'commit: 0\\.17\\.5-'")
    expect(mpvGradle).toContain('isReleaseBuild')
    expect(mpvGradle).toContain('Release builds require the libass 0.17.5 AAR')
  })
})
