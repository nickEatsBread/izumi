import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// Renovate moves the native pins (.github/renovate.json5); assert floors and agreement, not literals.
const atLeast = (version: string, floor: number[]) => {
  const parts = version.split('.').map(Number)
  for (let index = 0; index < floor.length; index += 1) {
    if ((parts[index] ?? 0) !== floor[index]) return (parts[index] ?? 0) > floor[index]
  }
  return true
}

describe('Android release hardening', () => {
  const ci = read('../../../.github/workflows/ci.yml')
  const preview = read('../../../.github/workflows/pr-build.yml')
  const release = read('../../../.github/workflows/release.yml')
  const scaffold = read('../../../scripts/ci/android-scaffold.sh')
  const verifyNative = read('../../../scripts/ci/verify-android-native.sh')
  const libmpvBuild = read('../../../scripts/ci/libmpv-android.sh')
  const toolchain = read('../../../scripts/ci/android-toolchain.env')
  const mpvGradle = read('../../../src-tauri/tauri-plugin-mpv/android/build.gradle.kts')
  const extPlayerGradle = read('../../../src-tauri/tauri-plugin-extplayer/android/build.gradle.kts')

  it('builds every Android path with NDK r28 or newer, from the one shared pin file', () => {
    // The NDK follows libmpv-android's depinfo.sh (scripts/ci/sync-upstream-pins.mjs); the r28
    // floor is what guarantees 16 KiB-aligned LOAD segments.
    const ndk = /^NDK_VERSION=(\d+\.\d+\.\d+)$/m.exec(toolchain)?.[1]
    expect(ndk).toBeDefined()
    expect(atLeast(ndk!, [28]), `NDK ${ndk}`).toBe(true)
    expect(toolchain).toMatch(/^BUILD_TOOLS=\d+\.\d+\.\d+$/m)
    for (const workflow of [ci, preview, release]) {
      expect(workflow).not.toMatch(/NDK_VERSION: "/)
      expect(workflow).toContain('scripts/ci/android-toolchain.env >> "$GITHUB_ENV"')
    }
    expect(libmpvBuild).toContain('source scripts/ci/android-toolchain.env')
    expect(libmpvBuild).toContain('grep -q "^v_ndk=${NDK_VERSION}$"')
  })

  it('pins target SDK 36 and verifies edge-to-edge handling', () => {
    expect(scaffold).toContain("s/compileSdk = [0-9]+/compileSdk = 36/")
    expect(scaffold).toContain("s/targetSdk = [0-9]+/targetSdk = 36/")
    expect(scaffold).toContain('enableEdgeToEdge()')
  })

  it('ships one AndroidX WebKit runtime through generated and plugin builds', () => {
    // 1.17.0 is where the 16 KiB-page-safe WebView shim landed; Renovate moves it forward.
    const webkit = /#androidx\.webkit:webkit:(\d+\.\d+\.\d+)#/.exec(scaffold)?.[1]
    expect(webkit).toBeDefined()
    expect(atLeast(webkit!, [1, 17, 0]), `webkit ${webkit}`).toBe(true)
    expect(scaffold).toContain(`grep -q 'androidx.webkit:webkit:${webkit}'`)
    expect(extPlayerGradle).toContain(`androidx.webkit:webkit:${webkit}`)
  })

  it('aligns APK entries to 16 KiB and verifies every ELF LOAD segment', () => {
    for (const workflow of [preview, release]) {
      expect(workflow).toContain('zipalign" -f -P 16 4')
      expect(workflow).toContain('verify-android-native.sh')
      expect(workflow).not.toContain('zipalign" -f -p 4')
    }
    expect(verifyNative).toContain('ZIPALIGN" -c -P 16 -v 4')
    expect(verifyNative).toContain('alignment < 0x4000')
    const requiredJobs = release.match(/  publish-release:[\s\S]*?\n    needs: \[([^\]]+)\]/)?.[1]
      .split(',').map(name => name.trim())
    expect(requiredJobs).toEqual(expect.arrayContaining([
      'create-release', 'build', 'flatpak', 'android', 'cleanup-release-signatures', 'worker-package',
    ]))
  })

  it('builds the shipped player from the pinned libass source build', () => {
    // 0.17.5 is the security fix Maven Central's AAR still lacks; the pin can only move forward.
    const libass = /^readonly LIBASS_VERSION="(\d+\.\d+\.\d+)"$/m.exec(libmpvBuild)?.[1]
    expect(libass).toBeDefined()
    expect(atLeast(libass!, [0, 17, 5]), `libass ${libass}`).toBe(true)
    expect(libmpvBuild).toMatch(/^readonly COMMIT="[0-9a-f]{40}"$/m)
    expect(libmpvBuild).toContain('grep -q "^v_libass=${LIBASS_VERSION}$"')
    expect(libmpvBuild).toContain('grep -F "commit: ${LIBASS_VERSION}-"')
    expect(preview).toContain('Build libmpv (reviewed source pin)')
    expect(release).toContain('Build libmpv (reviewed source pin)')
    expect(scaffold).toContain('secure libmpv AAR missing')
    // The scaffold reads the same pin instead of carrying its own copy.
    expect(scaffold).toContain('LIBASS_VERSION="$(sed -n \'s/^readonly LIBASS_VERSION="\\(.*\\)"$/\\1/p\' scripts/ci/libmpv-android.sh)"')
    expect(scaffold).toContain('grep -F "commit: ${LIBASS_VERSION}-"')
    expect(mpvGradle).toContain('isReleaseBuild')
    expect(mpvGradle).toContain('Release builds require the reviewed libass AAR')
  })

  it('keeps AAR assembly independent of upstream publishing infrastructure', () => {
    expect(libmpvBuild).toContain("sed -i '/alias(libs.plugins.maven.publish)/d'")
    expect(libmpvBuild).toContain("sed -i '/^mavenPublishing {/,/^}$/d'")
    expect(libmpvBuild).toContain("! grep -q 'vanniktech\\|mavenPublishing'")
    for (const workflow of [preview, release]) {
      expect(workflow).toContain("${{ hashFiles('scripts/ci/libmpv-android.sh', 'scripts/ci/android-toolchain.env') }}")
    }
  })
})
