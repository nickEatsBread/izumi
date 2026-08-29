import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8')
const player = read(new URL('./AndroidPlayer.svelte', import.meta.url))
const connecting = read(new URL('./SourceConnecting.svelte', import.meta.url))
const connectionStatus = read(new URL('./AndroidConnectionStatus.svelte', import.meta.url))
const preparing = read(new URL('./AndroidPreparingPlayer.svelte', import.meta.url))
const watchDetails = read(new URL('./AndroidWatchDetails.svelte', import.meta.url))
const caching = read(new URL('./DebridCaching.svelte', import.meta.url))
const picker = read(new URL('./StreamPicker.svelte', import.meta.url))
const detail = read(new URL('../detail/AnimeDetail.svelte', import.meta.url))
const layout = read(new URL('../../../routes/app/+layout.svelte', import.meta.url))
const native = read(new URL('../../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt', import.meta.url))

describe('Android UI contracts', () => {
  it('uses the native share sheet for a series', () => {
    expect(detail).toContain("invoke('plugin:extplayer|share_text'")
    expect(detail).toContain('aria-label="Share series"')
  })

  it('uses one integrated video-edge status rail on Android', () => {
    expect(connecting).toContain('{#if $isAndroid}')
    expect(connecting).toContain('<AndroidConnectionStatus')
    expect(picker).toContain('<AndroidConnectionStatus')
    expect(connectionStatus).toContain('class="android-connection inset-x-0')
    expect(connectionStatus).toContain("placement === 'player' ? 'absolute' : 'fixed'")
    expect(connectionStatus).toContain('56.25vw - 3.75rem')
    expect(connectionStatus).toContain('class="bar-loader h-full w-full"')
    expect(connecting).not.toContain('android-connect fixed')
    expect(picker).not.toContain('android-prepare fixed')
  })

  it('renders useful watch content while automatic source startup runs', () => {
    expect(picker).toContain('{#if $isAndroid && autoImmediate && !playbackError}')
    expect(layout).toContain('const androidWatchTarget = $derived.by(() => {')
    expect(layout).toContain('<Lazy load={loadAndroidPreparingPlayer}')
    expect(layout).toContain('active: $androidMpvActive, mini: $androidMiniPlayer')
    expect(picker).not.toContain('<AndroidPreparingPlayer')
    expect(connecting).not.toContain('<AndroidPreparingPlayer')
    expect(preparing).toContain('<AndroidWatchDetails')
    expect(watchDetails).not.toContain('resolvingSource')
    expect(player).toContain('$connecting != null')
    expect(caching).toContain('{#if $isAndroid}')
    expect(caching).not.toContain('<AndroidPreparingPlayer')
    expect(caching).toContain('<AndroidConnectionStatus')
    expect(player).toContain('$debridCaching != null')
  })

  it('keeps the Android discussion iframe mounted across the first video frame', () => {
    expect(layout).toContain('if ($androidMpvActive && $nowPlayingMedia) return $nowPlayingMedia')
    expect(preparing).toContain('class:active class:hidden={mini}')
    expect(preparing).toContain('{#if !active && art}')
    expect(player).not.toContain('<AndroidWatchDetails')
    expect(player).toContain('.player-shell > :not(.watch-details) { pointer-events: auto; }')
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

  it('lets fullscreen cross portrait while switching landscape sides', () => {
    const rotation = native.slice(
      native.indexOf('private fun cancelLandscapeReleaseTask()'),
      native.indexOf('/** Hide system bars for landscape playback'),
    )
    expect(rotation).toContain('removeCallbacks(it)')
    expect(rotation).toContain('var hasReachedLandscape = false')
    expect(rotation).toContain('hasReachedLandscape = true')
    expect(rotation).toContain('if (!hasReachedLandscape || !physicallyPortrait)')
    expect(rotation).toContain('if (landscapeReleaseTask != null) return')
    expect(rotation).toContain('postDelayed(releaseTask, LANDSCAPE_PORTRAIT_DWELL_MS)')
  })
})
