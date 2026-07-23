<script lang="ts">
  // Touch-first UI for the embedded Android libmpv player. Portrait is a watch page with the
  // native SurfaceView aligned to a 16:9 viewport; landscape becomes an immersive player.
  // Reuses izumi's play/track/aniskip plumbing.
  //
  // Interaction model (see docs/superpowers/specs/2026-07-15-android-player-rebuild-design.md):
  //   left/right thirds  — double-tap seek (by the seek-duration setting), vertical swipe = brightness/volume
  //   center             — single tap toggles controls, hold = temporary 2× speed
  //   horizontal drag    — live scrub anywhere over the video
  // A pure recognizer (android-gestures.ts) classifies each pointer stream; this component wires
  // its verdicts to mpv/native calls.
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { scale, fade } from 'svelte/transition'
  import {
    mpvState,
    androidMpvActive,
    mpvStop,
    mpvCommand,
    togglePause,
    seekAbsolute,
    seekRelative,
    haptic,
    grabThumb,
    mpvPip,
    getTracks,
    getChapters,
    setAudioTrack,
    setSubTrack,
    setPlayerViewport,
    setPlayerFullscreen,
    setPlayerTransform,
    type MpvTrack,
  } from '$lib/player/android-mpv'
  import {
    classifyDrag,
    fullscreenPullProgress,
    shouldEnterFullscreen,
    shouldDismissSheet,
    landscapeExitProgress,
    shouldExitFullscreen,
    MOVE_PX,
    HOLD_MS,
    DOUBLE_TAP_MS,
  } from '$lib/player/android-gestures'
  import { nowPlaying, nowPlayingMedia, streamPicker, commentsOpen } from '$lib/player/session'
  import { reportWatchPlayback } from '$lib/watch-together/client'
  import { autoSkip, seekDuration, scrubThumbnails } from '$lib/settings/ui'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { playNext, playPrev, playEpisode, finalizeAndroidWatch } from '$lib/stremio/play'
  import { stopDirectTorrentPlayback } from '$lib/player/direct-torrent'
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import Play from 'lucide-svelte/icons/play'
  import Pause from 'lucide-svelte/icons/pause'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'
  import RotateCw from 'lucide-svelte/icons/rotate-cw'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Lock from 'lucide-svelte/icons/lock'
  import Ratio from 'lucide-svelte/icons/ratio'
  import Layers from 'lucide-svelte/icons/layers'
  import PictureInPicture from 'lucide-svelte/icons/picture-in-picture-2'
  import Settings from 'lucide-svelte/icons/settings'
  import Maximize from 'lucide-svelte/icons/maximize'
  import Minimize from 'lucide-svelte/icons/minimize'
  import X from 'lucide-svelte/icons/x'
  import AndroidWatchDetails from './AndroidWatchDetails.svelte'

  let controlsShown = $state(true)
  let scrubbing = $state(false)
  let scrubPos = $state(0)
  let scrubOwner: 'bar' | 'surface' | null = null
  let scrubPointerId: number | null = null
  let locked = $state(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let barEl: HTMLElement | undefined = $state()
  let barGesture: 'pending' | 'scrub' | 'fullscreen' | null = null
  let barPointerId: number | null = null
  let barStartSample = { x: 0, y: 0, t: 0 }
  let rootEl: HTMLElement | undefined = $state()
  let landscape = $state(false)
  let safeTop = $state(0)
  let safeRight = $state(0)
  let safeBottom = $state(0)
  let safeLeft = $state(0)
  let portraitVideoHeight: number | null = $state(null)
  let fullscreenPull = $state(0)
  let fullscreenPullDragging = $state(false)
  let pullDim = $state(0) // 0..1 page-dim/scale progress, drives the enlarge + details fade
  let exitDrag = $state(0) // 0..1 landscape swipe-down-to-exit progress → dims the video
  let orientationForced = false

  const pos = $derived(scrubbing ? scrubPos : $mpvState.pos)
  const dur = $derived($mpvState.dur)
  const paused = $derived($mpvState.paused)
  const loading = $derived($mpvState.buffering || dur === 0)
  $effect(() => { reportWatchPlayback($mpvState.pos, $mpvState.dur, $mpvState.paused) })
  const playedPct = $derived(dur > 0 ? Math.min(100, (pos / dur) * 100) : 0)
  const cachePct = $derived(dur > 0 ? Math.min(100, ($mpvState.cacheEnd / dur) * 100) : 0)

  const np = $derived($nowPlaying)
  const hasPrev = $derived(np.episode != null && np.episode > 1)
  const hasNext = $derived(np.episode != null && np.total != null && np.episode < np.total)

  // --- AniSkip OP/ED/recap segments + chapters ---
  let segments = $state<Segment[]>([])
  let chapters = $state<number[]>([])
  let segKey = ''
  let autoSkipped = $state(new Set<number>())
  const currentSeg = $derived(segments.find((s) => pos >= s.start && pos <= s.end) ?? null)
  $effect(() => {
    const key = `${np.malId}:${np.episode}`
    if (dur > 0 && key !== segKey) {
      segKey = key
      autoSkipped = new Set()
      thumbCache.clear() // new file → drop cached preview frames
      getSkipSegments(np.malId, np.episode, dur).then((s) => (segments = s))
      getChapters().then((c) => (chapters = c))
    }
  })
  $effect(() => {
    const seg = currentSeg
    if (seg && $autoSkip && !autoSkipped.has(seg.start)) { autoSkipped.add(seg.start); seekAbsolute(seg.end) }
  })
  function skipSegment() { if (currentSeg) seekAbsolute(currentSeg.end) }

  function fmt(s: number) {
    if (!isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const mm = h > 0 ? m.toString().padStart(2, '0') : m.toString()
    return `${h > 0 ? h + ':' : ''}${mm}:${sec.toString().padStart(2, '0')}`
  }

  function armHide() { clearTimeout(hideTimer); if (!paused && !scrubbing) hideTimer = setTimeout(() => (controlsShown = false), 3500) }
  function showControls() { controlsShown = true; armHide() }
  function toggleControls() {
    if (scrubbing) { controlsShown = true; return }
    controlsShown = !controlsShown
    if (controlsShown) armHide()
  }
  $effect(() => { if (paused) { clearTimeout(hideTimer); controlsShown = true } else if (controlsShown) armHide() })

  // --- Seek preview: move the UI thumb while dragging, then issue one exact seek on release ---
  function fracFromX(clientX: number) {
    if (!barEl) return 0
    const r = barEl.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  function schedulePreview(sec: number) {
    scrubPos = Math.max(0, dur > 0 ? Math.min(dur, sec) : sec)
  }
  function clearScrub() {
    const owner = scrubOwner
    const pointerId = scrubPointerId
    scrubbing = false
    scrubOwner = null
    scrubPointerId = null
    if (pointerId == null) return
    const el = owner === 'bar' ? barEl : owner === 'surface' ? rootEl : null
    try { if (el?.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId) } catch { /* ignore */ }
  }
  function cancelScrub() {
    if (!scrubbing && scrubOwner == null) return
    clearScrub()
  }
  function beginScrub(owner: 'bar' | 'surface', pointerId: number, initialPos: number) {
    // A new gesture always invalidates an orphaned preview from a lost/cancelled pointer.
    cancelScrub()
    resetTapSequence()
    scrubOwner = owner
    scrubPointerId = pointerId
    scrubPos = Math.max(0, dur > 0 ? Math.min(dur, initialPos) : initialPos)
    scrubbing = true
    clearTimeout(hideTimer)
    controlsShown = true
  }
  function endScrub(owner: 'bar' | 'surface', pointerId: number) {
    if (!scrubbing || scrubOwner !== owner || scrubPointerId !== pointerId) return false
    const target = scrubPos
    clearScrub()
    void seekAbsolute(target).catch(() => {}) // state must clear even if the native command rejects
    return true
  }
  function onBarDown(e: PointerEvent) {
    if (!e.isPrimary) return
    e.stopPropagation()
    cancelScrub()
    resetTapSequence()
    barGesture = 'pending'
    barPointerId = e.pointerId
    barStartSample = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    const rect = rootEl?.getBoundingClientRect()
    pullPlayerTop = rect?.top ?? 0
    pullPlayerHeight = rect?.height ?? Math.round(window.innerWidth * 9 / 16)
    pullLastY = e.clientY
    pullLastTime = e.timeStamp
    pullVelocityY = 0
    clearTimeout(hideTimer)
    controlsShown = true
    barEl?.setPointerCapture(e.pointerId)
  }
  // The bar delays claiming the pointer until intent is clear. Horizontal movement/taps seek;
  // an upward pull from the bottom edge is handed to the portrait fullscreen gesture.
  function onBarMove(e: PointerEvent) {
    if (barPointerId !== e.pointerId) return
    e.stopPropagation()
    if (barGesture === 'pending') {
      const dx = e.clientX - barStartSample.x
      const dy = e.clientY - barStartSample.y
      if (Math.abs(dx) < MOVE_PX && Math.abs(dy) < MOVE_PX) return
      if (!landscape && dy < -MOVE_PX && Math.abs(dy) > Math.abs(dx)) {
        barGesture = 'fullscreen'
        fullscreenPullDragging = true
        controlsShown = false // clean video while it zooms toward fullscreen
        startSample = barStartSample
        updateFullscreenPull(e)
        return
      }
      barGesture = 'scrub'
      beginScrub('bar', e.pointerId, fracFromX(barStartSample.x) * dur)
    }
    if (barGesture === 'scrub') {
      schedulePreview(fracFromX(e.clientX) * dur)
    } else if (barGesture === 'fullscreen') {
      updateFullscreenPull(e)
    }
  }
  function onBarUp(e: PointerEvent) {
    if (barPointerId !== e.pointerId) return
    e.stopPropagation()
    barPointerId = null
    if (barGesture === 'pending') {
      beginScrub('bar', e.pointerId, fracFromX(e.clientX) * dur)
      endScrub('bar', e.pointerId)
      armHide()
    } else if (barGesture === 'scrub') {
      if (endScrub('bar', e.pointerId)) armHide()
    } else if (barGesture === 'fullscreen') {
      fullscreenPullDragging = false
      if (shouldEnterFullscreen(fullscreenPull, pullVelocityY)) void enterFullscreen()
      else { resetFullscreenPull(); armHide() }
    }
    barGesture = null
    try { if (barEl?.hasPointerCapture(e.pointerId)) barEl.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  function onBarCancel(e: PointerEvent) {
    if (barPointerId !== e.pointerId) return
    e.stopPropagation()
    barPointerId = null
    if (barGesture === 'scrub') cancelScrub()
    if (barGesture === 'fullscreen') resetFullscreenPull()
    barGesture = null
    armHide()
    try { if (barEl?.hasPointerCapture(e.pointerId)) barEl.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  function onBarLostCapture(e: PointerEvent) {
    if (barPointerId === e.pointerId) onBarCancel(e)
  }

  function skip(delta: number) {
    cancelScrub()
    resetTapSequence()
    const target = Math.max(0, $mpvState.pos + delta)
    void seekAbsolute(dur > 0 ? Math.min(dur, target) : target)
  }
  function pressPause() { cancelScrub(); resetTapSequence(); void togglePause() }

  // --- Scrub thumbnail preview (debounced + cached, best-effort; falls back to the time bubble) ---
  let thumbUrl = $state<string | null>(null)
  let thumbDebounce: ReturnType<typeof setTimeout> | undefined
  const thumbCache = new Map<number, string | null>()
  const THUMB_BUCKET = 10 // seconds per cached frame
  function requestThumb(sec: number) {
    if (!$scrubThumbnails || dur <= 0) { thumbUrl = null; return }
    const bucket = Math.floor(sec / THUMB_BUCKET)
    if (thumbCache.has(bucket)) { thumbUrl = thumbCache.get(bucket) ?? null; return }
    clearTimeout(thumbDebounce)
    thumbDebounce = setTimeout(async () => {
      const url = await grabThumb(bucket * THUMB_BUCKET)
      thumbCache.set(bucket, url)
      if (scrubbing) thumbUrl = url
    }, 150)
  }
  $effect(() => { if (scrubbing) requestThumb(scrubPos); else thumbUrl = null })

  // --- Tap → controls toggle / YouTube-style sticky double-tap seek ---
  // A double-tap on a side enters "seek mode"; while it stays open (SEEK_MODE_MS after the last tap)
  // every FURTHER single tap on that side adds another step (10 → 20 → 30…) — you don't re-double-tap.
  // Tapping the other side reverses. A lone side tap only toggles controls, and that toggle is delayed
  // by the double-tap window so rapid taps aren't misread as toggles (the flicker/stuck-state failure).
  // Every recognized seek tap is applied immediately; the visual total remains until seek mode closes.
  const SEEK_MODE_MS = 650 // seek mode stays open this long after the last tap (DoubleTapPlayerView default)
  let seekFlash = $state<{ side: 'l' | 'r'; amt: number } | null>(null)
  let seekActive = false
  let seekSide: 'l' | 'r' | null = null
  let pendingToggle: ReturnType<typeof setTimeout> | undefined
  let firstTapSide: 'l' | 'r' | null = null
  let seekModeTimer: ReturnType<typeof setTimeout> | undefined

  function endSeekMode() {
    seekActive = false; seekSide = null; seekFlash = null
  }
  function resetTapSequence() {
    clearTimeout(pendingToggle); pendingToggle = undefined; firstTapSide = null
    clearTimeout(seekModeTimer); seekModeTimer = undefined
    endSeekMode()
  }
  function armSeekTimer() {
    clearTimeout(seekModeTimer); seekModeTimer = setTimeout(endSeekMode, SEEK_MODE_MS)
  }
  // One seek "tap" while in (or entering) seek mode: accumulate on the same side, reverse on the other.
  function bumpSeek(side: 'l' | 'r') {
    const step = $seekDuration
    if (!seekActive || seekSide !== side) {
      seekActive = true; seekSide = side; seekFlash = { side, amt: step }
    } else {
      seekFlash = { side, amt: (seekFlash?.amt ?? 0) + step }
    }
    void seekRelative(side === 'r' ? step : -step)
    haptic(15)
    armSeekTimer()
  }
  function onTap(e: PointerEvent) {
    if (locked) { showLockToggle(); return }
    const w = window.innerWidth
    const side: 'l' | 'c' | 'r' = e.clientX < w / 3 ? 'l' : e.clientX > (2 * w) / 3 ? 'r' : 'c'
    if (side === 'c') { clearTimeout(pendingToggle); pendingToggle = undefined; firstTapSide = null; toggleControls(); return }
    if (seekActive) { bumpSeek(side); return } // already seeking → each single tap keeps accumulating
    if (pendingToggle && firstTapSide === side) { // second tap of a pair → enter seek mode
      clearTimeout(pendingToggle); pendingToggle = undefined; firstTapSide = null
      bumpSeek(side)
    } else { // first side tap → delay the controls toggle so a second tap can pair into a seek
      clearTimeout(pendingToggle); firstTapSide = side
      pendingToggle = setTimeout(() => { pendingToggle = undefined; firstTapSide = null; toggleControls() }, DOUBLE_TAP_MS)
    }
  }

  // --- Whole-surface gesture layer: tap / double-tap / swipe brightness+volume / hold-2× / scrub ---
  type GestureKind = 'scrub' | 'fullscreen' | 'exit' | 'brightness' | 'volume' | 'hold' | 'none' | null
  let gesture = $state<GestureKind>(null)
  let startSample = { x: 0, y: 0, t: 0 }
  let scrubStartPos = 0
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let heldSpeed = $state(false)
  let rootPointerId: number | null = null
  let pullPlayerTop = 0
  let pullPlayerHeight = 0
  let pullLastY = 0
  let pullLastTime = 0
  let pullVelocityY = 0
  let pullTransformBusy = false
  let pendingPullTransform: { scale: number; ty: number } | null = null
  let pullAnimFrame = 0
  let exitAnimFrame = 0
  const VIDEO_SCRUB_SPAN = 90 // seconds spanned by a full-width horizontal drag over the video
  const PULL_SCALE_GAIN = 0.6 // extra surface scale at a full pull (1 → 1.6), YouTube-style zoom
  const PULL_LIFT_FRACTION = 0.18 // upward translate at a full pull, as a fraction of video height

  // Coalesced native-surface transform: only the latest (scale, translate) is ever in flight, so a
  // fast drag never floods the IPC bridge. Unlike a viewport resize this is a cheap compositor op.
  function queuePullTransform(scale: number, tyCssPx: number) {
    const dpr = window.devicePixelRatio || 1
    pendingPullTransform = { scale, ty: Math.round(tyCssPx * dpr) }
    if (pullTransformBusy) return
    pullTransformBusy = true
    void (async () => {
      while (pendingPullTransform != null) {
        const t = pendingPullTransform
        pendingPullTransform = null
        await setPlayerTransform(t.scale, t.ty).catch(() => {})
      }
      pullTransformBusy = false
    })()
  }

  // Map a 0..1 pull progress to the live surface zoom + upward lift + page dim. The 16:9 box itself
  // stays put — the video scales as one unit over the (fading) details pane, like YouTube.
  function applyPull(progress: number) {
    pullDim = progress
    const scale = 1 + PULL_SCALE_GAIN * progress
    const lift = -PULL_LIFT_FRACTION * pullPlayerHeight * progress
    queuePullTransform(scale, lift)
  }

  // Ease the pull to a target progress (used for the spring-back on cancel).
  function animatePullTo(from: number, to: number) {
    cancelAnimationFrame(pullAnimFrame)
    let startTs = 0
    const DUR = 200
    const step = (ts: number) => {
      if (!startTs) startTs = ts
      const k = Math.min(1, (ts - startTs) / DUR)
      const eased = 1 - Math.pow(1 - k, 3) // easeOutCubic
      applyPull(from + (to - from) * eased)
      if (k < 1) pullAnimFrame = requestAnimationFrame(step)
    }
    pullAnimFrame = requestAnimationFrame(step)
  }

  function updateFullscreenPull(e: PointerEvent) {
    cancelAnimationFrame(pullAnimFrame)
    const dt = Math.max(1, e.timeStamp - pullLastTime)
    const velocity = (e.clientY - pullLastY) / dt
    pullVelocityY = pullVelocityY * 0.65 + velocity * 0.35
    pullLastY = e.clientY
    pullLastTime = e.timeStamp
    fullscreenPull = fullscreenPullProgress(
      startSample,
      { x: e.clientX, y: e.clientY, t: e.timeStamp },
      pullPlayerTop,
      pullPlayerHeight,
    )
    applyPull(fullscreenPull)
  }

  function resetFullscreenPull() {
    fullscreenPullDragging = false
    const from = fullscreenPull
    fullscreenPull = 0
    animatePullTo(from, 0) // eases scale/lift/dim back to the resting 16:9 box
  }

  // Landscape swipe-DOWN to exit fullscreen — mirror of the pull-up. Dims the video as the finger
  // drags, commits to portrait past a threshold/fling, springs back otherwise. A pure DOM dim (no
  // native surface transform) so it can't interact badly with the landscape→portrait rotation.
  function updateExitDrag(e: PointerEvent) {
    cancelAnimationFrame(exitAnimFrame)
    const dt = Math.max(1, e.timeStamp - pullLastTime)
    const velocity = (e.clientY - pullLastY) / dt
    pullVelocityY = pullVelocityY * 0.65 + velocity * 0.35
    pullLastY = e.clientY
    pullLastTime = e.timeStamp
    exitDrag = landscapeExitProgress(
      startSample,
      { x: e.clientX, y: e.clientY, t: e.timeStamp },
      window.innerHeight,
    )
  }

  function animateExitTo(from: number, to: number) {
    cancelAnimationFrame(exitAnimFrame)
    let startTs = 0
    const DUR = 200
    const step = (ts: number) => {
      if (!startTs) startTs = ts
      const k = Math.min(1, (ts - startTs) / DUR)
      const eased = 1 - Math.pow(1 - k, 3)
      exitDrag = from + (to - from) * eased
      if (k < 1) exitAnimFrame = requestAnimationFrame(step)
    }
    exitAnimFrame = requestAnimationFrame(step)
  }

  function resetExitDrag() {
    animateExitTo(exitDrag, 0)
  }

  async function enterFullscreen() {
    cancelAnimationFrame(pullAnimFrame)
    orientationForced = true
    controlsShown = false
    // Let the pull zoom ride the rotation into fullscreen instead of un-zooming first (that reads as
    // a hiccup). The orientation change runs syncViewport → viewport(), which resets the surface to
    // identity as it fills the screen; pullDim is likewise zeroed there once landscape settles.
    try {
      await setPlayerFullscreen(true)
    } catch {
      orientationForced = false
      resetFullscreenPull()
      flashToast('Could not enter fullscreen')
    }
  }

  async function exitAndroidFullscreen() {
    orientationForced = false
    await setPlayerFullscreen(false).catch(() => {})
    showControls()
  }

  function toggleAndroidFullscreen() {
    cancelScrub()
    resetTapSequence()
    if (landscape) void exitAndroidFullscreen()
    else void enterFullscreen()
  }

  function onRootDown(e: PointerEvent) {
    if (locked || !e.isPrimary || rootPointerId != null) return
    cancelScrub()
    rootPointerId = e.pointerId
    rootEl?.setPointerCapture?.(e.pointerId)
    startSample = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    const rect = rootEl?.getBoundingClientRect()
    pullPlayerTop = rect?.top ?? 0
    pullPlayerHeight = rect?.height ?? Math.round(window.innerWidth * 9 / 16)
    pullLastY = e.clientY
    pullLastTime = e.timeStamp
    pullVelocityY = 0
    gesture = null
    holdTimer = setTimeout(() => { // press-and-hold anywhere on unobstructed video → temporary 2×
      if (gesture === null) {
        gesture = 'hold'; heldSpeed = true; mpvCommand(['set', 'speed', '2']); haptic(15)
      }
    }, HOLD_MS)
  }
  function onRootMove(e: PointerEvent) {
    if (locked || gesture === 'hold' || rootPointerId !== e.pointerId) return
    const cur = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    if (gesture === null) {
      const pull = !landscape
        ? fullscreenPullProgress(startSample, cur, pullPlayerTop, pullPlayerHeight)
        : 0
      if (pull > 0) {
        clearTimeout(holdTimer)
        gesture = 'fullscreen'
        fullscreenPullDragging = true
        controlsShown = false // clean video while it zooms toward fullscreen
        resetTapSequence()
        updateFullscreenPull(e)
        return
      }
      const exit = landscape
        ? landscapeExitProgress(startSample, cur, window.innerHeight)
        : 0
      if (exit > 0) {
        clearTimeout(holdTimer)
        gesture = 'exit'
        controlsShown = false // clean video while it slides toward the inline player
        resetTapSequence()
        updateExitDrag(e)
        return
      }
      const g = classifyDrag(startSample, cur, window.innerWidth, window.innerHeight)
      if (g.kind === 'pending') return
      clearTimeout(holdTimer)
      gesture = g.kind === 'scrub' ? 'scrub' : 'none'
      if (gesture === 'scrub') {
        scrubStartPos = $mpvState.pos
        beginScrub('surface', e.pointerId, scrubStartPos)
      }
    }
    if (gesture === 'scrub') {
      schedulePreview(scrubStartPos + ((cur.x - startSample.x) / window.innerWidth) * VIDEO_SCRUB_SPAN)
    } else if (gesture === 'fullscreen') {
      updateFullscreenPull(e)
    } else if (gesture === 'exit') {
      updateExitDrag(e)
    }
  }
  function onRootUp(e: PointerEvent) {
    if (rootPointerId !== e.pointerId) return
    rootPointerId = null
    clearTimeout(holdTimer)
    if (heldSpeed) { heldSpeed = false; mpvCommand(['set', 'speed', String(speed)]) }
    if (gesture === 'scrub') { endScrub('surface', e.pointerId); armHide() }
    else if (gesture === 'fullscreen') {
      fullscreenPullDragging = false
      if (shouldEnterFullscreen(fullscreenPull, pullVelocityY)) void enterFullscreen()
      else { resetFullscreenPull(); armHide() }
    }
    else if (gesture === 'exit') {
      if (shouldExitFullscreen(exitDrag, pullVelocityY)) void exitAndroidFullscreen()
      else { resetExitDrag(); armHide() }
    }
    else if (gesture === null) onTap(e) // no drag happened → treat as a tap
    gesture = null
    try { rootEl?.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  }
  function onRootCancel(e: PointerEvent) {
    if (rootPointerId !== e.pointerId) return
    rootPointerId = null
    clearTimeout(holdTimer)
    if (heldSpeed) { heldSpeed = false; void mpvCommand(['set', 'speed', String(speed)]) }
    if (scrubOwner === 'surface' && scrubPointerId === e.pointerId) cancelScrub()
    if (gesture === 'fullscreen') resetFullscreenPull()
    if (gesture === 'exit') resetExitDrag()
    gesture = null
    armHide()
    try { rootEl?.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  }
  function onRootLostCapture(e: PointerEvent) {
    if (rootPointerId === e.pointerId) onRootCancel(e)
  }

  // --- Lock ---
  let lockToggleShown = $state(false)
  let lockToggleTimer: ReturnType<typeof setTimeout> | undefined
  function showLockToggle() { lockToggleShown = true; clearTimeout(lockToggleTimer); lockToggleTimer = setTimeout(() => (lockToggleShown = false), 2500) }
  function toggleLock() { locked = !locked; lockToggleShown = false; if (!locked) showControls() }

  // --- Resize (video fit) ---
  const FITS = ['Fit', 'Crop', 'Stretch']
  let fitIdx = $state(0)
  let toast = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function flashToast(t: string) { toast = t; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast = ''), 1400) }
  function setFit(index: number) {
    fitIdx = index
    if (fitIdx === 0) { mpvCommand(['set', 'keepaspect', 'yes']); mpvCommand(['set', 'panscan', '0']) }
    else if (fitIdx === 1) { mpvCommand(['set', 'keepaspect', 'yes']); mpvCommand(['set', 'panscan', '1.0']) }
    else { mpvCommand(['set', 'keepaspect', 'no']); mpvCommand(['set', 'panscan', '0']) }
    flashToast(`Resize: ${FITS[fitIdx]}`)
  }

  // --- Sheets ---
  type Sheet = null | 'settings'
  let sheet = $state<Sheet>(null)
  let tracks = $state<MpvTrack[]>([])
  const audioTracks = $derived(tracks.filter((t) => t.type === 'audio'))
  const subTracks = $derived(tracks.filter((t) => t.type === 'sub'))
  const subOff = $derived(!subTracks.some((t) => t.selected))
  async function openSettings() {
    clearTimeout(hideTimer)
    clearTimeout(sheetCloseTimer)
    cancelAnimationFrame(sheetOpenFrame)
    sheetDragging = false
    sheetClosing = false
    sheetDrag = landscape ? 0 : window.innerHeight
    sheetBackdropOpacity = landscape ? 1 : 0
    sheet = 'settings'
    if (!landscape) {
      // Two frames guarantee the off-screen transform is painted before the animated resting state.
      sheetOpenFrame = requestAnimationFrame(() => {
        sheetOpenFrame = requestAnimationFrame(() => {
          if (!sheet || sheetClosing) return
          sheetDrag = 0
          sheetBackdropOpacity = 1
        })
      })
    }
    tracks = await getTracks()
  }
  function trackLabel(t: MpvTrack) { return [t.lang?.toUpperCase(), t.title].filter(Boolean).join(' · ') || `Track ${t.id}` }
  async function pickAudio(id: number) { await setAudioTrack(id); tracks = await getTracks() }
  async function pickSub(id: number | 'no') { await setSubTrack(id); tracks = await getTracks() }
  function changeSource() { sheet = null; const m = $nowPlayingMedia; if (m) playEpisode(m.media, m.episode, () => {}) }

  let speed = $state(1)
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; mpvCommand(['set', 'speed', String(v)]) }
  const overlayHidden = $derived($streamPicker != null || $commentsOpen)

  // Pull-down sheet: follow the finger exactly, then animate either home or fully off-screen.
  let sheetDrag = $state(0)
  let sheetBackdropOpacity = $state(1)
  let sheetDragging = $state(false)
  let sheetClosing = $state(false)
  let sheetPointerId: number | null = null
  let sheetStartY = 0
  let sheetLastY = 0
  let sheetLastTime = 0
  let sheetVelocityY = 0
  let sheetCloseTimer: ReturnType<typeof setTimeout> | undefined
  let sheetOpenFrame = 0
  function resetSheetState() {
    sheetDrag = 0
    sheetBackdropOpacity = 1
    sheetDragging = false
    sheetClosing = false
    sheetPointerId = null
    sheetStartY = 0
    sheetVelocityY = 0
  }
  function finishSheetClose() { sheet = null; resetSheetState() }
  function dismissSettings() {
    if (!sheet || sheetClosing) return
    cancelAnimationFrame(sheetOpenFrame)
    if (landscape) { finishSheetClose(); return }
    sheetDragging = false
    sheetClosing = true
    sheetBackdropOpacity = 0
    sheetDrag = Math.max(sheetDrag, window.innerHeight)
    clearTimeout(sheetCloseTimer)
    sheetCloseTimer = setTimeout(finishSheetClose, 280)
  }
  function handleDown(e: PointerEvent) {
    if (!e.isPrimary || landscape || sheetClosing) return
    e.stopPropagation()
    sheetPointerId = e.pointerId
    sheetStartY = e.clientY
    sheetLastY = e.clientY
    sheetLastTime = e.timeStamp
    sheetVelocityY = 0
    sheetDragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function handleMove(e: PointerEvent) {
    if (sheetPointerId !== e.pointerId) return
    e.stopPropagation()
    const dt = Math.max(1, e.timeStamp - sheetLastTime)
    const instantaneousVelocity = (e.clientY - sheetLastY) / dt
    sheetVelocityY = sheetVelocityY * 0.65 + instantaneousVelocity * 0.35
    sheetLastY = e.clientY
    sheetLastTime = e.timeStamp
    sheetDrag = Math.max(0, e.clientY - sheetStartY)
    sheetBackdropOpacity = Math.max(0, 1 - sheetDrag / Math.max(320, window.innerHeight * 0.55))
  }
  function releaseSheetPointer(e: PointerEvent) {
    sheetPointerId = null
    try {
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
  }
  function handleUp(e: PointerEvent) {
    if (sheetPointerId !== e.pointerId) return
    e.stopPropagation()
    const idleMs = Math.max(0, e.timeStamp - sheetLastTime)
    const releaseVelocity = sheetVelocityY * Math.max(0, 1 - idleMs / 160)
    releaseSheetPointer(e)
    sheetDragging = false
    if (shouldDismissSheet(sheetDrag, releaseVelocity, window.innerHeight)) dismissSettings()
    else { sheetDrag = 0; sheetBackdropOpacity = 1 }
  }
  function handleCancel(e: PointerEvent) {
    if (sheetPointerId !== e.pointerId) return
    e.stopPropagation()
    releaseSheetPointer(e)
    sheetDragging = false
    sheetDrag = 0
    sheetBackdropOpacity = 1
  }

  async function close() {
    finalizeAndroidWatch($mpvState.pos, $mpvState.dur)
    await mpvStop().catch(() => {})
    await stopDirectTorrentPlayback()
    if (orientationForced) await setPlayerFullscreen(false).catch(() => {})
    androidMpvActive.set(false)
  }
  async function openRelated(id: number) {
    await close()
    await goto(`/app/anime/${id}`)
  }

  let viewportGeneration = 0
  async function syncViewport() {
    const generation = ++viewportGeneration
    const nextLandscape = window.matchMedia('(orientation: landscape)').matches
    landscape = nextLandscape
    const ratioHeight = Math.round(window.innerWidth * 9 / 16)
    const dpr = window.devicePixelRatio || 1
    const insets = await setPlayerViewport(0, nextLandscape ? 0 : ratioHeight * dpr, nextLandscape)
    if (generation !== viewportGeneration) return
    cancelAnimationFrame(pullAnimFrame)
    cancelAnimationFrame(exitAnimFrame)
    fullscreenPullDragging = false
    fullscreenPull = 0
    pullDim = 0 // the viewport call above already reset the native surface transform to identity
    exitDrag = 0
    portraitVideoHeight = nextLandscape ? null : ratioHeight
    safeTop = insets.top / dpr
    safeRight = insets.right / dpr
    safeBottom = insets.bottom / dpr
    safeLeft = insets.left / dpr
  }

  onMount(() => {
    armHide()
    const orientation = window.matchMedia('(orientation: landscape)')
    let viewportFrame = 0
    const scheduleViewportSync = () => {
      cancelAnimationFrame(viewportFrame)
      viewportFrame = requestAnimationFrame(syncViewport)
    }
    orientation.addEventListener('change', scheduleViewportSync)
    window.addEventListener('resize', scheduleViewportSync)
    scheduleViewportSync()
    return () => {
      clearTimeout(hideTimer); clearTimeout(pendingToggle); clearTimeout(seekModeTimer)
      clearTimeout(lockToggleTimer); clearTimeout(toastTimer)
      clearTimeout(holdTimer); clearTimeout(thumbDebounce); clearTimeout(sheetCloseTimer)
      cancelAnimationFrame(sheetOpenFrame)
      cancelAnimationFrame(pullAnimFrame)
      cancelAnimationFrame(exitAnimFrame)
      pendingPullTransform = null
      cancelScrub()
      cancelAnimationFrame(viewportFrame)
      orientation.removeEventListener('change', scheduleViewportSync)
      window.removeEventListener('resize', scheduleViewportSync)
    }
  })
</script>

<div class="player-shell fixed inset-0 z-50 select-none overflow-hidden text-white" class:hidden={overlayHidden} class:pulling-fullscreen={fullscreenPullDragging}
  style={`--player-safe-top:${safeTop}px;--player-safe-right:${safeRight}px;--player-safe-bottom:${safeBottom}px;--player-safe-left:${safeLeft}px;--portrait-player-height:${portraitVideoHeight == null ? 'calc(100vw * 9 / 16)' : `${portraitVideoHeight}px`}`}>
  <section bind:this={rootEl} class="video-frame relative touch-none overflow-visible bg-transparent"
    onpointerdown={onRootDown} onpointermove={onRootMove} onpointerup={onRootUp} onpointercancel={onRootCancel} onlostpointercapture={onRootLostCapture} role="presentation">
  <!-- Buffering shows a spinner INSTEAD of the play/pause transport, but only while playing — when
       paused, keep the play button so you can resume. -->
  {#if loading && !paused}
    <div class="pointer-events-none absolute inset-0 grid place-items-center"><Loader size={52} class="animate-spin text-white/90" /></div>
  {/if}

  {#if exitDrag > 0}
    <!-- Landscape swipe-down-to-exit: dim the video as the finger pulls it toward the inline player. -->
    <div class="pointer-events-none absolute inset-0 z-10 bg-black" style:opacity={exitDrag * 0.6}></div>
  {/if}

  {#if seekFlash}
    <!-- YouTube-style curved pulse: the side third with a rounded (arc) inner edge, a pulse that
         re-fires on each accumulated tap, and the direction arrow + running total. -->
    <div class="pointer-events-none absolute inset-y-0 flex w-2/5 items-center justify-center overflow-hidden {seekFlash.side === 'l' ? 'left-0 rounded-r-[50%]' : 'right-0 rounded-l-[50%]'}">
      {#key seekFlash.amt}
        <div class="absolute inset-0 animate-[seekpulse_0.5s_ease-out] bg-white/90 opacity-0"></div>
      {/key}
      <div class="relative flex flex-col items-center gap-1 text-white drop-shadow-lg">
        {#if seekFlash.side === 'l'}<RotateCcw size={34} />{:else}<RotateCw size={34} />{/if}
        <span class="text-base font-black">{seekFlash.amt}s</span>
      </div>
    </div>
  {/if}

  {#if toast}
    <div class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-5 py-2.5 text-sm font-bold backdrop-blur">{toast}</div>
  {/if}

  {#if heldSpeed}
    <div class="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-black/65 px-4 py-2 text-sm font-black backdrop-blur landscape:top-[max(1rem,var(--player-safe-top))]">
      2× speed
    </div>
  {/if}

  {#if currentSeg && !($autoSkip && !autoSkipped.has(currentSeg.start))}
    <button transition:fade={{ duration: 180 }} onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skipSegment() }} class="absolute bottom-14 right-3 z-10 rounded-lg bg-white/90 px-4 py-2 text-sm font-bold text-black shadow-lg">Skip {currentSeg.label}</button>
  {/if}

  <!-- Locked: only an unlock affordance -->
  {#if locked}
    {#if lockToggleShown}
      <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); toggleLock() }} class="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 grid h-14 w-14 place-items-center rounded-full bg-black/50 backdrop-blur" aria-label="Unlock"><Lock size={24} /></button>
    {/if}
  {:else if controlsShown}
    <div transition:fade={{ duration: 180 }} class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/75"></div>

    <!-- Top bar -->
    <div transition:fade={{ duration: 180 }} class="player-top-bar absolute inset-x-0 top-0 flex items-center gap-2 p-2 landscape:p-3" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} role="presentation">
      <button onclick={close} class="grid h-10 w-10 shrink-0 place-items-center active:scale-90" aria-label="Close player">
        {#if landscape}<ChevronLeft size={27} />{:else}<ChevronDown size={29} />{/if}
      </button>
      {#if landscape}
        <div class="min-w-0 flex-1">
          <div class="truncate text-base font-bold">{np.animeTitle ?? np.title}</div>
          {#if np.episode != null}<div class="truncate text-[11px] text-white/70">Episode {np.episode}{np.total ? ` / ${np.total}` : ''}</div>{/if}
        </div>
      {:else}
        <div class="flex-1"></div>
      {/if}
      <button onclick={openSettings} class="grid h-10 w-10 shrink-0 place-items-center active:scale-90" aria-label="Video settings"><Settings size={24} /></button>
    </div>

    <!-- Center transport (morphing play/pause). Hidden while buffering-and-playing (spinner shows);
         always shown when paused so you can resume. -->
    {#if !loading || paused}
      <div transition:fade|global={{ duration: 180 }} class="pointer-events-none absolute inset-0 flex items-center justify-center gap-10">
        <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip(-$seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Rewind"><RotateCcw size={30} /></button>
        <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); pressPause() }} class="pointer-events-auto grid h-[68px] w-[68px] place-items-center rounded-full bg-white/15 backdrop-blur transition-transform active:scale-90" aria-label={paused ? 'Play' : 'Pause'}>
          {#key paused}
            <span in:scale={{ duration: 160, start: 0.5 }} class="grid place-items-center">
              {#if paused}<Play size={38} class="ml-1" fill="currentColor" />{:else}<Pause size={38} fill="currentColor" />{/if}
            </span>
          {/key}
        </button>
        <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip($seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Forward"><RotateCw size={30} /></button>
      </div>
    {/if}

    <!-- Timeline sits on the actual bottom edge of the video, matching native mobile players. -->
    <div transition:fade={{ duration: 180 }} class="player-timeline absolute inset-x-0 bottom-0 h-14" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="timeline-controls absolute inset-x-0 bottom-3 flex items-center justify-between px-3 text-xs tabular-nums text-white/90">
        <span class="pointer-events-none">{fmt(pos)} / {fmt(dur)}</span>
        <button
          class="grid h-9 w-9 place-items-center active:scale-90"
          onpointerdown={(e) => e.stopPropagation()}
          onpointerup={(e) => e.stopPropagation()}
          onclick={(e) => { e.stopPropagation(); toggleAndroidFullscreen() }}
          aria-label={landscape ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {#if landscape}<Minimize size={22} />{:else}<Maximize size={22} />{/if}
        </button>
      </div>
      <div bind:this={barEl} class="timeline-hitbox absolute inset-x-0 bottom-0 h-5 w-full cursor-pointer touch-none" onpointerdown={onBarDown} onpointermove={onBarMove} onpointerup={onBarUp} onpointercancel={onBarCancel} onlostpointercapture={onBarLostCapture}
             role="slider" tabindex="0" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}>
        <div class="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/25">
          <div class="absolute inset-y-0 left-0 bg-white/40" style="width:{cachePct}%"></div>
          {#each segments as s (s.type + s.start)}
            <div class="absolute inset-y-0 {s.type === 'op' ? 'bg-sky-400/60' : s.type === 'ed' ? 'bg-fuchsia-400/60' : 'bg-amber-400/60'}" style="left:{(s.start / dur) * 100}%;width:{((s.end - s.start) / dur) * 100}%"></div>
          {/each}
          <div class="absolute inset-y-0 left-0 bg-theme" style="width:{playedPct}%"></div>
        </div>
        {#each chapters as c (c)}<div class="absolute bottom-0 h-1 w-[3px] -translate-x-1/2 rounded-full bg-black/70" style="left:{(c / dur) * 100}%"></div>{/each}
        <div class="absolute -bottom-[5px] h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-theme shadow-md" style="left:clamp(7px, {playedPct}%, calc(100% - 7px))"></div>
        {#if scrubbing}
          <div class="pointer-events-none absolute bottom-8 flex -translate-x-1/2 flex-col items-center gap-1" style="left:{playedPct}%">
            {#if thumbUrl}<img src={thumbUrl} alt="" class="h-20 w-36 rounded-md border border-white/20 object-cover shadow-lg" />{/if}
            <span class="rounded bg-black/80 px-2 py-0.5 text-xs font-bold tabular-nums">{fmt(pos)}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  </section>

  {#if !landscape}
    <!-- Fades out as the video zooms so the enlarging native surface shows through it (the video is
         behind the WebView — an opaque details pane would otherwise clip the lower half of the zoom). -->
    <section class="watch-details overflow-y-auto" style:opacity={1 - pullDim} style:pointer-events={pullDim > 0 ? 'none' : null}>
      {#if $nowPlayingMedia}
        <AndroidWatchDetails
          media={$nowPlayingMedia.media}
          episode={np.episode}
          total={np.total}
          {hasPrev}
          {hasNext}
          onPrev={() => playPrev()}
          onNext={() => playNext()}
          onPip={() => { controlsShown = false; void mpvPip() }}
          onRelated={openRelated}
        />
      {:else}
        <div class="px-4 py-5"><h1 class="text-xl font-extrabold">{np.animeTitle ?? np.title}</h1></div>
      {/if}
    </section>
  {/if}

  <!-- Sheets -->
  {#if sheet}
    <div class="settings-backdrop absolute inset-0 z-30 bg-black/60" style:opacity={sheetBackdropOpacity} onpointerdown={(e) => e.stopPropagation()} onpointermove={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); dismissSettings() }} role="presentation"></div>
    <!-- stopPropagation on move+up too (not just down) so swiping the sheet / scrolling the list never
         leaks to the video's gesture layer underneath (the "interferes with the video" bug). -->
    <div class="settings-sheet absolute z-40 bg-neutral-900 shadow-2xl" class:sheet-dragging={sheetDragging} class:sheet-closing={sheetClosing} style="transform:translateY({sheetDrag}px)" onpointerdown={(e) => e.stopPropagation()} onpointermove={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Video settings" tabindex="-1">
      <!-- drag handle (only this dismisses on swipe, so the list scrolls normally) -->
      <div class="sheet-handle cursor-grab py-4 touch-none active:cursor-grabbing" onpointerdown={handleDown} onpointermove={handleMove} onpointerup={handleUp} onpointercancel={handleCancel} onlostpointercapture={handleCancel} role="presentation">
        <div class="mx-auto h-1 w-10 rounded-full bg-white/25"></div>
      </div>
      <div class="flex items-center justify-between px-5 pb-3 landscape:pt-4">
        <div><h2 class="text-lg font-extrabold">Video settings</h2><p class="text-xs text-white/45">Everything for this stream, in one place</p></div>
        <button onclick={dismissSettings} class="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Close"><X size={21} /></button>
      </div>
      <div class="settings-body overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button onclick={changeSource} class="mb-3 flex w-full items-center gap-3 rounded-lg bg-white/10 px-3 py-3 text-left text-sm font-bold hover:bg-white/15"><Layers size={20} /> Change source…</button>
          <p class="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-white/50">Playback speed</p>
          <div class="mb-5 flex flex-wrap gap-2">
            {#each SPEEDS as v (v)}
              <button onclick={() => setSpeed(v)} class="rounded-full px-4 py-2 text-sm font-bold {speed === v ? 'bg-theme text-white' : 'bg-white/10 text-white/80'}">{v}×</button>
            {/each}
          </div>
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">Display</p>
          <div class="mb-5 grid grid-cols-3 gap-2">
            {#each FITS as fit, i (fit)}
              <button onclick={() => setFit(i)} class="flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold {fitIdx === i ? 'bg-theme text-white' : 'bg-white/10 text-white/80'}"><Ratio size={16} /> {fit}</button>
            {/each}
          </div>
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">Subtitles</p>
          <button onclick={() => pickSub('no')} class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm {subOff ? 'bg-theme/20 font-bold text-theme' : 'hover:bg-white/10'}">Off {#if subOff}<span>✓</span>{/if}</button>
          {#each subTracks as t (t.id)}
            <button onclick={() => pickSub(t.id)} class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm {t.selected ? 'bg-theme/20 font-bold text-theme' : 'hover:bg-white/10'}">{trackLabel(t)} {#if t.selected}<span>✓</span>{/if}</button>
          {/each}
          <p class="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-white/50">Audio</p>
          {#each audioTracks as t (t.id)}
            <button onclick={() => pickAudio(t.id)} class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm {t.selected ? 'bg-theme/20 font-bold text-theme' : 'hover:bg-white/10'}">{trackLabel(t)} {#if t.selected}<span>✓</span>{/if}</button>
          {:else}
            <p class="px-3 py-2 text-sm text-white/40">Only one audio track.</p>
          {/each}
          <button onclick={toggleLock} class="mb-2 mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.07]"><Lock size={20} /><span class="text-sm font-bold">{locked ? 'Unlock controls' : 'Lock controls'}</span></button>
          <button onclick={() => { sheet = null; controlsShown = false; mpvPip() }} class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.07]"><PictureInPicture size={20} /><span class="text-sm font-bold">Open miniplayer</span></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .player-shell { touch-action: none; background: transparent; }
  .video-frame { width: 100%; height: var(--portrait-player-height); margin-top: var(--player-safe-top); transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .watch-details { height: calc(100% - var(--player-safe-top) - var(--portrait-player-height)); touch-action: pan-y; background: #0a0a0b; transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .pulling-fullscreen .video-frame, .pulling-fullscreen .watch-details { transition: none; }
  .settings-backdrop { transition: opacity 240ms ease-out; }
  .settings-sheet { inset-inline: 0; bottom: 0; max-height: 86%; border-radius: 1.25rem 1.25rem 0 0; transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform; }
  .settings-sheet.sheet-dragging { transition: none; }
  .settings-body { max-height: calc(86vh - 5.25rem); touch-action: pan-y; }

  @media (orientation: landscape) {
    .video-frame { width: 100%; height: 100%; margin-top: 0; aspect-ratio: auto; overflow: hidden; }
    .player-top-bar { padding-top: max(0.75rem, var(--player-safe-top)); padding-right: max(0.75rem, var(--player-safe-right)); padding-left: max(0.75rem, var(--player-safe-left)); }
    .player-timeline { left: max(3rem, calc(var(--player-safe-left) + 1.5rem), 6vw); right: max(3rem, calc(var(--player-safe-right) + 1.5rem), 6vw); bottom: max(2.5rem, calc(var(--player-safe-bottom) + 1.25rem)); height: 3.5rem; padding: 0; }
    .timeline-controls { padding: 0; }
    .settings-sheet { inset-block: 0; right: 0; left: auto; width: min(28rem, 48vw); max-height: none; border-radius: 1.25rem 0 0 1.25rem; transform: none !important; transition: none; }
    .settings-body { max-height: calc(100vh - 5.75rem); padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
    .sheet-handle { display: none; }
  }
</style>
