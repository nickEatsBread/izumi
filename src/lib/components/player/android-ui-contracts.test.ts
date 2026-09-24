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

  it('keeps the shell up through an episode handover and covers the surface instead', () => {
    // `display:none` on the shell never hid the native surface behind the transparent page: the
    // outgoing episode kept playing with no controls for the whole resolve, and the shell then
    // popped back over a black surface because "playing" is reported when `loadfile` is queued.
    expect(player).toContain('const resolvingNext = $derived($androidMpvActive && ($connecting != null ||')
    expect(player).toContain('const overlayHidden = $derived(pickerDialog || $debridCaching != null || $commentsOpen || $androidPipActive)')
    expect(player).not.toMatch(/const overlayHidden = \$derived\([^\n]*\$connecting != null/)
    expect(player).toContain('{#if handover}')
    expect(player).toContain('class="handover-veil')
    expect(player).toContain('{:else if controlsShown && !handover}')
    // Ends on the replacement's first frame, or at once when the resolve is cancelled.
    expect(player).toContain('const frameSeen = firstFrameSeen')
    expect(player).toContain('if (loadId === handoverLoadId) {')
    // Watch-page Previous/Next and episode rows take the in-place advance path while playing.
    expect(preparing).toContain('playEpisodeFromWatchPage(media, target')
    expect(watchDetails).toContain('playEpisodeFromWatchPage(media, ep')
  })

  it('keeps the Android discussion iframe mounted across the first video frame', () => {
    expect(layout).toContain('if ($androidMpvActive && $nowPlayingMedia) return $nowPlayingMedia')
    expect(preparing).toContain('class:active class:hidden={mini && pull.progress >= 1}')
    expect(preparing).toContain('{#if !active && art}')
    expect(player).not.toContain('<AndroidWatchDetails')
    expect(player).toContain('.player-shell > :not(.watch-details) { pointer-events: auto; }')
  })

  it('collapses portrait playback over the page it came from, YouTube-style', () => {
    // No navigation to Home mid-animation: the route underneath is revealed and kept.
    expect(player).not.toContain("goto('/app/home')")
    expect(player).toContain('androidMiniPlayer.set(true)')
    expect(player).toContain("gesture = 'minimize'")
    expect(layout).toContain('$androidMpvActive && !$androidMiniPlayer')
    expect(layout).toContain("const fullPlayerActive = $playing || ($androidMpvActive && !$androidMiniPlayer)")
    expect(layout).toContain("const lock = fullPlayerActive ? 'hidden' : ''")
    expect(player).toContain('if (native) queuePullTransform(t.scale, t.ty, t.tx, p > 0)')
    // Direct manipulation: the finger's travel is the video centre's travel, released into a spring
    // that carries the lift-off velocity, and the docked rect is the spring's own end frame.
    expect(player).toContain('miniPullRecognized(startSample, cur)')
    expect(player).toContain('applyMiniPull(miniPullProgress(e.clientY - startSample.y, miniTravel))')
    expect(player).toContain("if (miniPullOutcome(miniPull, velocity) === 'dock') dockMiniPlayer(velocity)")
    expect(player).toContain('state = stepSpring(state, to, dt)')
    expect(player).toContain('miniDock = miniTarget')
    expect(player).toContain('style:top={miniLayout && miniDock ? `${miniDock.top}px` : null}')
    // The watch page travels and fades with the video instead of vanishing on the first frame.
    expect(player).toContain('androidMiniPull.set({ progress: p, shiftY: miniDetailsShift(p, miniSource, miniTarget) })')
    expect(preparing).toContain('class:hidden={mini && pull.progress >= 1}')
    expect(preparing).toContain('style:transform={pull.shiftY ? `translate3d(0, ${pull.shiftY}px, 0)` : null}')
  })

  it('keeps the docked bar stable from screen to screen', () => {
    // Pages reserve the bar's height; the navigation it rests on stops auto-hiding.
    expect(layout).toContain("$androidMiniPlayer ? 'mb-[calc(8rem+env(safe-area-inset-bottom))]'")
    expect(read(new URL('../shell/BottomNav.svelte', import.meta.url))).toContain("hidden && !$androidMiniPlayer ? 'translate-y-full'")
    // Whoever clears the flag (a fresh play from the page behind the bar) also drops the layout.
    expect(player).toContain('if ($androidMiniPlayer || !miniLayout || !$androidMpvActive || closing) return')
    // Docked gestures: swipe up expands, swipe down dismisses, and the expand never flashes
    // full-size because the layout write carries the docked transform.
    expect(player).toContain("if (dy < 0) { dockGesture = 'expand'; void prepareExpand() }")
    expect(player).toContain("if (miniDismissOutcome(miniDismiss, velocity) === 'close') void dismissMiniPlayer()")
    expect(player).toContain('scale: t.scale, translateX: t.tx * dpr, translateY: t.ty * dpr,')
    expect(native).toContain('var translateY: Int = 0\n}\n\n@InvokeArg\nclass FullscreenArgs')
    expect(native).toContain('playerContainer.pivotX = pivotWidth / 2f')
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
