import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8')
const player = read(new URL('./AndroidPlayer.svelte', import.meta.url))
const connecting = read(new URL('./SourceConnecting.svelte', import.meta.url))
const picker = read(new URL('./StreamPicker.svelte', import.meta.url))
const detail = read(new URL('../detail/AnimeDetail.svelte', import.meta.url))
const layout = read(new URL('../../../routes/app/+layout.svelte', import.meta.url))
const native = read(new URL('../../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt', import.meta.url))

describe('Android UI contracts', () => {
  it('uses the native share sheet for a series', () => {
    expect(detail).toContain("invoke('plugin:extplayer|share_text'")
    expect(detail).toContain('aria-label="Share series"')
  })

  it('uses a bottom-edge loader instead of the full connecting screen on Android', () => {
    expect(connecting).toContain('{#if $isAndroid}')
    expect(connecting).toContain('class="bar-loader h-1.5 w-full"')
    expect(connecting).toContain('top: calc(env(safe-area-inset-top) + 56.25vw')
    expect(picker).toContain("directP2p ? 'Preparing download' : 'Connecting'")
    expect(picker).toContain('class="android-prepare fixed inset-x-4')
  })

  it('collapses portrait playback to Home and reveals browse behind the mini-player', () => {
    expect(player).toContain("void goto('/app/home')")
    expect(player).toContain('androidMiniPlayer.set(true)')
    expect(player).toContain("gesture = 'minimize'")
    expect(layout).toContain('$androidMpvActive && !$androidMiniPlayer')
    expect(layout).toContain("const fullPlayerActive = $playing || ($androidMpvActive && !$androidMiniPlayer)")
    expect(layout).toContain("const lock = fullPlayerActive ? 'hidden' : ''")
    expect(player).toContain('style:opacity={(miniPullDragging || miniCommitting || miniPull > 0) ? 1 - miniPull')
    expect(player).toContain('pullTranslateX, p > 0')
  })

  it('keeps stale drag transforms out of Android system PiP', () => {
    expect(player).toContain('async function drainPullTransforms()')
    expect(player).toContain('await drainPullTransforms()')
    expect(native).toContain('params.leftMargin = 0')
    expect(native).toContain('if (pipActive || pipRequested)')
    expect(native).toContain('return@runOnUiThread')
  })
})
