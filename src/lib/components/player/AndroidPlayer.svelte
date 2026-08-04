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
  import { get } from 'svelte/store'
  import { goto } from '$app/navigation'
  import { invoke } from '@tauri-apps/api/core'
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
    androidPipActive,
    androidGifStart,
    androidGifStop,
    androidGifAbort,
    getTracks,
    getChapterList,
    setAudioTrack,
    setSubTrack,
    setPlayerViewport,
    setPlayerFullscreen,
    setPlayerTransform,
    setAndroidAutoPip,
    setAndroidKeepScreenAwake,
    setAndroidMediaSession,
    setAndroidMediaHandler,
    type MpvTrack,
  } from '$lib/player/android-mpv'
  import {
    classifyDrag,
    fullscreenPullProgress,
    fullscreenPullTransform,
    shouldEnterFullscreen,
    shouldDismissSheet,
    landscapeExitProgress,
    shouldExitFullscreen,
    MOVE_PX,
    HOLD_MS,
    DOUBLE_TAP_MS,
  } from '$lib/player/android-gestures'
  import { nowPlaying, nowPlayingMedia, streamPicker, commentsOpen, onlineSubCandidates, subtitleNotice } from '$lib/player/session'
  import { reportWatchPlayback } from '$lib/watch-together/client'
  import {
    autoSkip, seekDuration, scrubThumbnails, openSubtitlesToken,
    subtitleStyleEnabled, subtitleFont, subtitleFontSize, subtitleTextColor,
    subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition,
    gifIncludeSubtitles, androidAutoPip, keepAwakeWhilePlaying,
  } from '$lib/settings/ui'
  import { subtitleStyleProps } from '$lib/player/subtitle-style'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { mergeSkipSegments, segmentsFromChapters } from '$lib/player/chapter-skip'
  import { firstOccurrences } from '$lib/anime/animethemes'
  import { playNext, playPrev, playEpisode, finalizeAndroidWatch, searchOnlineSubtitles } from '$lib/stremio/play'
  import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'
  import { candidateKey, candidateTitle, providerBadge, subtitleErrorNotice, candidateApiKey, candidateDownloadUrl } from './online-subs'
  import { stopDirectTorrentPlayback } from '$lib/player/direct-torrent'
  import { mediaHref } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import Lock from '@lucide/svelte/icons/lock'
  import Ratio from '@lucide/svelte/icons/ratio'
  import Layers from '@lucide/svelte/icons/layers'
  import Film from '@lucide/svelte/icons/film'
  import Gauge from '@lucide/svelte/icons/gauge'
  import Captions from '@lucide/svelte/icons/captions'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import Check from '@lucide/svelte/icons/check'
  import Settings from '@lucide/svelte/icons/settings'
  import Maximize from '@lucide/svelte/icons/maximize'
  import Minimize from '@lucide/svelte/icons/minimize'
  import X from '@lucide/svelte/icons/x'
  import AndroidWatchDetails from './AndroidWatchDetails.svelte'
  import BufferSpinner from './BufferSpinner.svelte'

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
  let pullScale = $state(1)
  let pullTranslateY = $state(0)
  let pullDetailsOffset = $state(0)
  let exitDrag = $state(0) // 0..1 landscape swipe-down-to-exit progress → dims the video
  let orientationForced = false

  const pos = $derived(scrubbing ? scrubPos : $mpvState.pos)
  const dur = $derived($mpvState.dur)
  const paused = $derived($mpvState.paused)
  $effect(() => {
    const activelyWatching = $androidMpvActive && $mpvState.frameReady && !$mpvState.paused && !$mpvState.eof
    void setAndroidKeepScreenAwake($keepAwakeWhilePlaying && activelyWatching)
  })
  // One loading signal, mirroring the desktop overlay. `paused-for-cache` alone only catches a stall
  // during playback — seeking into unfetched data reports `seeking`/`core-idle` instead, plus our own
  // `seekBusy` for the window before the native command is even picked up. `core-idle` is ALSO true
  // whenever playback is merely paused, so it must never be read without the `!paused` guard.
  const stalled = $derived(
    !$mpvState.eof &&
      (!$mpvState.frameReady ||
        dur === 0 ||
        $mpvState.seekBusy ||
        $mpvState.seeking ||
        $mpvState.buffering ||
        (!paused && $mpvState.coreIdle)),
  )
  // Anti-flash: a seek that lands inside the cache resolves in a few frames, and blinking a spinner
  // for it looks broken. Pre-first-frame (no duration yet) there is nothing to flash over, so that
  // case shows immediately.
  const SPINNER_DELAY_MS = 280
  let loading = $state(false)
  $effect(() => {
    if (!stalled) { loading = false; return }
    if (dur === 0) { loading = true; return }
    const t = setTimeout(() => (loading = true), SPINNER_DELAY_MS)
    return () => clearTimeout(t)
  })
  $effect(() => { reportWatchPlayback($mpvState.pos, $mpvState.dur, $mpvState.paused, $mpvState.buffering) })

  // Subtitle appearance. Same property set the desktop overlay pushes — Android simply never applied
  // it, so every control on Settings → Subtitles was inert here. Re-keyed on the loaded file as well
  // as on the settings themselves: the core is reused across episodes, but a fresh core (player
  // closed and reopened) starts from mpv's defaults.
  $effect(() => {
    void np.id, np.episode
    for (const [property, value] of subtitleStyleProps({
      enabled: $subtitleStyleEnabled,
      font: $subtitleFont,
      fontSize: $subtitleFontSize,
      textColor: $subtitleTextColor,
      borderColor: $subtitleBorderColor,
      borderSize: $subtitleBorderSize,
      shadow: $subtitleShadow,
      position: $subtitlePosition,
    })) void mpvCommand(['set', property, value]).catch(() => {})
  })
  const playedPct = $derived(dur > 0 ? Math.min(100, (pos / dur) * 100) : 0)
  const cachePct = $derived(dur > 0 ? Math.min(100, ($mpvState.cacheEnd / dur) * 100) : 0)

  const np = $derived($nowPlaying)
  const hasPrev = $derived(np.episode != null && np.episode > 1)
  const hasNext = $derived(np.episode != null && np.total != null && np.episode < np.total)

  // --- System integration: miniplayer on leave + lock-screen transport ---
  //
  // The notification/lock-screen control — including the scrubber the user drags to skim the
  // episode — is drawn by Android from a MediaSession the plugin owns, not by this component. All
  // that happens here is keeping the now-playing identity current and answering the two buttons
  // that need episode logic; play/pause and seek are served natively, so they still work in the
  // window where Android has frozen this WebView.
  const mediaArtwork = $derived(
    $nowPlayingMedia?.media.coverImage?.extraLarge ?? $nowPlayingMedia?.media.coverImage?.medium ?? null,
  )
  $effect(() => { void setAndroidAutoPip($androidAutoPip) })
  $effect(() => {
    void setAndroidMediaSession({
      enabled: true,
      title: np.animeTitle || np.title || 'izumi',
      subtitle: np.episode != null
        ? `Episode ${np.episode}${np.total ? ` / ${np.total}` : ''}`
        : np.title,
      artwork: mediaArtwork,
      hasPrev,
      hasNext,
    })
  })

  // --- AniSkip OP/ED/recap segments + chapters ---
  let segments = $state<Segment[]>([])
  let chapters = $state<number[]>([])
  let segKey = ''
  let autoSkipped = $state(new Set<number>())
  // AnimeThemes: don't auto-skip the episode where an OP/ED first debuts, so each new theme is
  // heard once. Matches the desktop overlay — and it matters more now that chapter-derived
  // segments mean more titles have OP/ED bands at all.
  let firstOcc = $state({ op: false, ed: false })
  const currentSeg = $derived(segments.find((s) => pos >= s.start && pos <= s.end) ?? null)
  const willSkip = (s: Segment) =>
    $autoSkip && !((s.type === 'op' && firstOcc.op) || (s.type === 'ed' && firstOcc.ed))
  $effect(() => {
    const key = `${np.malId}:${np.episode}`
    if (dur > 0 && key !== segKey) {
      segKey = key
      autoSkipped = new Set()
      firstOcc = { op: false, ed: false }
      thumbCache.clear() // new file → drop cached preview frames
      void (async () => {
        // Assign the debut guard before the segments it guards — the auto-skip effect fires as soon
        // as `segments` lands.
        const [segs, occ, chapterList] = await Promise.all([
          getSkipSegments(np.malId, np.episode, dur),
          firstOccurrences(np.id, np.episode),
          getChapterList().catch(() => []),
        ])
        if (key !== segKey) return
        firstOcc = occ
        chapters = chapterList.map((c) => c.time)
        segments = mergeSkipSegments(segs, segmentsFromChapters(chapterList, dur))
      })()
    }
  })
  $effect(() => {
    const seg = currentSeg
    if (seg && willSkip(seg) && !autoSkipped.has(seg.start)) { autoSkipped.add(seg.start); seekAbsolute(seg.end) }
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
  // Bar geometry, measured once per scrub gesture. Reading getBoundingClientRect() on every
  // pointermove was a textbook read→write→read thrash: the move writes `scrubPos`, which drives the
  // thumb and bubble, and the NEXT move's measurement then forces a synchronous layout flush to
  // resolve it — 60-120 forced layouts a second mid-drag on the weakest devices we ship to.
  // Deliberately NOT populated on pointerdown: while `barGesture` is still 'pending' the move
  // handler can promote to the fullscreen-pull gesture, which itself mutates layout. Only cached
  // once the gesture is committed to 'scrub', where the bar is guaranteed to hold still.
  let barRect: { left: number; width: number } | null = null
  function measureBar() {
    const r = barEl?.getBoundingClientRect()
    barRect = r ? { left: r.left, width: r.width } : null
  }
  function fracFromX(clientX: number) {
    let r = barRect
    if (!r) {
      const b = barEl?.getBoundingClientRect()
      if (!b) return 0
      r = { left: b.left, width: b.width }
    }
    if (!r.width) return 0
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
      measureBar() // committed to scrubbing — the bar can't move from here, so cache its geometry
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
    barRect = null // next gesture re-measures; the bar moves with rotation and fullscreen changes
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
  // Tapping the other side reverses. A lone side tap toggles controls immediately; the pairing timer
  // only decides whether a following tap should seek, so normal show/hide interactions never feel late.
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
    } else { // first side tap → respond now while keeping a short pairing window for seek
      clearTimeout(pendingToggle); firstTapSide = side
      toggleControls()
      pendingToggle = setTimeout(() => { pendingToggle = undefined; firstTapSide = null }, DOUBLE_TAP_MS)
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

  // Move the native clipped container and its HTML control frame with identical geometry. YouTube's
  // gesture enlarges the player rectangle modestly; the big transition happens on rotation after
  // release. A surface-only 1.6× zoom is what made the old animation crop and escape the player.
  function applyPull(progress: number) {
    pullDim = progress
    const transform = fullscreenPullTransform(progress, pullPlayerHeight)
    pullScale = transform.scale
    pullTranslateY = transform.translateY
    // Scaling around the player's centre grows its lower edge. Move the watch page by exactly that
    // overlap so the player remains a rectangle in layout instead of ghosting through page content.
    pullDetailsOffset = Math.max(0, pullPlayerHeight * (transform.scale - 1) / 2 + transform.translateY)
    queuePullTransform(transform.scale, transform.translateY)
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
    // NOTE: deliberately does not bail on `locked`. Bailing here meant onRootUp never ran, so
    // onTap never ran, so onTap's `if (locked) showLockToggle()` branch was dead code — and in
    // landscape immersive there is no top bar, no chevron and no other way back, making the lock a
    // one-way trap that could only be escaped by force-quitting (losing the unfinalized position).
    if (!e.isPrimary || rootPointerId != null) return
    // Blank areas of visible chrome are still part of the video gesture surface. Actual controls
    // remain ordinary taps, so a pull-up can begin beside them without stealing a button press.
    const target = e.target
    if (target instanceof Element && target.closest('button, a, input, select, textarea, [role="slider"]')) return
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
    // Locked = taps only (to reveal the unlock button). onRootMove already early-returns on
    // `locked`, so this is the one gesture that still needs suppressing.
    if (locked) return
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
  // Surface the unlock affordance immediately on locking, so the way back is never a secret.
  function toggleLock() { locked = !locked; lockToggleShown = false; if (locked) showLockToggle(); else showControls() }

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
  type SettingsPage = 'main' | 'speed' | 'display' | 'subtitles' | 'audio' | 'capture'
  let sheet = $state<Sheet>(null)
  let settingsPage = $state<SettingsPage>('main')
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
    sheetDrag = window.innerHeight
    sheetBackdropOpacity = 0
    sheet = 'settings'
    settingsPage = 'main'
    // Two frames guarantee the off-screen transform is painted before the animated resting state.
    // Landscape uses the same bottom sheet as portrait (the phone-video convention) — it is not a
    // side drawer, so the slide-up/drag-to-dismiss behaviour is orientation-independent.
    sheetOpenFrame = requestAnimationFrame(() => {
      sheetOpenFrame = requestAnimationFrame(() => {
        if (!sheet || sheetClosing) return
        sheetDrag = 0
        sheetBackdropOpacity = 1
      })
    })
    tracks = await getTracks()
  }
  function trackLabel(t: MpvTrack) { return [t.lang?.toUpperCase(), t.title].filter(Boolean).join(' · ') || `Track ${t.id}` }
  function selectedTrackLabel(type: 'audio' | 'sub'): string {
    const selected = tracks.find((track) => track.type === type && track.selected)
    return selected ? trackLabel(selected) : type === 'sub' ? 'Off' : 'Default'
  }
  function settingsTitle(): string {
    return settingsPage === 'speed' ? 'Playback speed'
      : settingsPage === 'display' ? 'Resize'
      : settingsPage === 'subtitles' ? 'Subtitles'
      : settingsPage === 'audio' ? 'Audio track'
      : settingsPage === 'capture' ? 'Capture'
      : 'Video settings'
  }
  async function pickAudio(id: number) { await setAudioTrack(id); tracks = await getTracks() }
  async function pickSub(id: number | 'no') { await setSubTrack(id); tracks = await getTracks() }
  let downloadingSubtitle = $state<string | null>(null)
  async function addOnlineSub(candidate: SubtitleCandidate) {
    const key = candidateKey(candidate)
    downloadingSubtitle = key
    try {
      const path = await invoke<string>('player_add_subtitle', {
        provider: candidate.provider,
        url: candidateDownloadUrl(candidate),
        fileId: candidate.download?.fileId,
        lang: candidate.lang ?? 'und',
        title: candidateTitle(candidate),
        apiKey: candidateApiKey(candidate.provider),
        token: $openSubtitlesToken,
      })
      await mpvCommand([
        'sub-add',
        path,
        'select',
        candidateTitle(candidate),
        candidate.lang ?? 'und',
      ])
      tracks = await getTracks()
      subtitleNotice.set('')
    } catch (error) {
      subtitleNotice.set(subtitleErrorNotice(candidate.provider, error))
    } finally {
      downloadingSubtitle = null
    }
  }
  async function refreshOnlineSubtitles() {
    await searchOnlineSubtitles()
  }
  function changeSource() {
    sheet = null
    const m = $nowPlayingMedia
    // autoplay always: picking a replacement source is an explicit "play this" (see Controls).
    if (m) playEpisode(m.media, m.episode, () => {}, { forceManual: true, autoplay: true })
  }

  let speed = $state(1)
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; mpvCommand(['set', 'speed', String(v)]) }
  // In picture-in-picture the WebView is scaled down to the miniplayer window with it. Every pixel it
  // paints — the watch page's opaque background above all — lands on top of the video surface, so the
  // whole shell goes away and the transparent WebView leaves nothing but the video.
  const overlayHidden = $derived($streamPicker != null || $commentsOpen || $androidPipActive)

  // --- GIF recording ---
  // Same 30s bound the desktop recorder uses. The native worker stops itself there too; the UI stop
  // keeps the badge honest instead of counting up forever against a capture that already ended.
  const GIF_MAX_SECONDS = 30
  let gifRecording = $state(false)
  let gifBusy = $state(false)
  let gifElapsed = $state(0)
  let gifStartedAt = 0
  $effect(() => {
    if (!gifRecording) { gifElapsed = 0; return }
    const tick = () => {
      gifElapsed = Math.min(GIF_MAX_SECONDS, Math.round((Date.now() - gifStartedAt) / 1000))
      if (gifElapsed >= GIF_MAX_SECONDS) void toggleGifRecording()
    }
    const timer = setInterval(tick, 250)
    tick()
    return () => clearInterval(timer)
  })
  async function toggleGifRecording() {
    if (gifBusy) return
    if (!gifRecording) {
      gifBusy = true
      try {
        await androidGifStart($gifIncludeSubtitles)
        gifStartedAt = Date.now()
        gifRecording = true
        sheet = null
        haptic(15)
        flashToast('Recording GIF…')
      } catch {
        flashToast('GIF recording failed to start')
      } finally {
        gifBusy = false
      }
      return
    }
    gifBusy = true
    gifRecording = false
    flashToast('Encoding GIF…')
    try {
      const saved = await androidGifStop()
      haptic(15)
      flashToast(`GIF saved to ${saved.location}`)
    } catch (error) {
      flashToast(String(error).includes('gif-no-frames') ? 'GIF captured no frames' : 'GIF recording failed')
    } finally {
      gifBusy = false
    }
  }

  // Leaving picture-in-picture returns the activity to a full-size window, so the native surface has
  // to be given the watch-page geometry again. The plugin restores its last viewport immediately;
  // this re-measures from the (now correct) CSS layout.
  let wasPip = false
  $effect(() => {
    if ($androidPipActive) { wasPip = true; return }
    if (!wasPip) return
    wasPip = false
    void syncViewport()
  })

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
    sheetDragging = false
    sheetClosing = true
    sheetBackdropOpacity = 0
    sheetDrag = Math.max(sheetDrag, window.innerHeight)
    clearTimeout(sheetCloseTimer)
    sheetCloseTimer = setTimeout(finishSheetClose, 280)
  }
  function handleDown(e: PointerEvent) {
    if (!e.isPrimary || sheetClosing) return
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
    if (gifRecording) { gifRecording = false; await androidGifAbort() }
    finalizeAndroidWatch($mpvState.pos, $mpvState.dur)
    await mpvStop().catch(() => {})
    await stopDirectTorrentPlayback()
    if (orientationForced) await setPlayerFullscreen(false).catch(() => {})
    androidMpvActive.set(false)
  }
  // Related titles are not all playable — a series' source manga or light novel is a relation like
  // any other — so the destination comes from the node itself. Hardcoding the anime route sent
  // every reading title to a query for `Media(id, type: ANIME)`, which AniList answers "Not Found".
  async function openRelated(media: Media) {
    await close()
    await goto(mediaHref(media))
  }

  let viewportGeneration = 0
  async function syncViewport() {
    // The miniplayer window is its own resize, and re-measuring the watch-page layout inside it is
    // exactly what used to push the video out of frame. The native side ignores viewport calls while
    // in PiP as well; this just avoids the pointless round trip.
    if (get(androidPipActive)) return
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
    pullScale = 1
    pullTranslateY = 0
    pullDetailsOffset = 0
    exitDrag = 0
    portraitVideoHeight = nextLandscape ? null : ratioHeight
    safeTop = insets.top / dpr
    safeRight = insets.right / dpr
    safeBottom = insets.bottom / dpr
    safeLeft = insets.left / dpr
  }

  onMount(() => {
    armHide()
    setAndroidMediaHandler((action) => {
      if (action === 'next') { if (hasNext) void playNext(undefined, !paused) }
      else if (action === 'prev') { if (hasPrev) void playPrev(undefined, !paused) }
      else void close()
    })
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
      setAndroidMediaHandler(null)
      void setAndroidKeepScreenAwake(false)
      // `mpv_stop` already drops the session natively; this covers an unmount without a stop
      // (the overlay being torn down while the core is reused for the next episode).
      void setAndroidMediaSession({ enabled: false })
    }
  })
</script>

<div class="player-shell fixed inset-0 z-50 select-none overflow-hidden text-white" class:hidden={overlayHidden} class:pulling-fullscreen={fullscreenPullDragging || pullDim > 0}
  style={`--player-safe-top:${safeTop}px;--player-safe-right:${safeRight}px;--player-safe-bottom:${safeBottom}px;--player-safe-left:${safeLeft}px;--portrait-player-height:${portraitVideoHeight == null ? 'calc(100vw * 9 / 16)' : `${portraitVideoHeight}px`}`}>
  <section bind:this={rootEl} class="video-frame relative touch-none bg-transparent"
    style:transform={`translate3d(0, ${pullTranslateY}px, 0) scale(${pullScale})`}
    onpointerdown={onRootDown} onpointermove={onRootMove} onpointerup={onRootUp} onpointercancel={onRootCancel} onlostpointercapture={onRootLostCapture} role="presentation">
  <!-- Loading with the controls hidden (or locked): the spinner is the only thing on screen, so it
       still reads as "working on it" without a tap. With controls up it moves into the transport
       button below instead, so the play/pause target is never taken away. -->
  {#if loading && (!controlsShown || locked)}
    <div transition:fade={{ duration: 150 }} class="pointer-events-none absolute inset-0 grid place-items-center">
      <BufferSpinner size={48} />
    </div>
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

  {#if gifRecording}
    <!-- The sheet closes when recording starts, so this is the only thing telling you a capture is
         running — and the only way to end it without reopening the menu. -->
    <button transition:fade={{ duration: 150 }} onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()}
            onclick={(e) => { e.stopPropagation(); void toggleGifRecording() }}
            class="absolute bottom-14 left-3 z-20 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-black tabular-nums backdrop-blur landscape:left-[max(0.75rem,var(--player-safe-left))]"
            aria-label="Stop GIF recording">
      <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
      GIF {gifElapsed}s
    </button>
  {/if}

  {#if currentSeg && !(willSkip(currentSeg) && !autoSkipped.has(currentSeg.start))}
    <button transition:fade={{ duration: 180 }} onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skipSegment() }} class="absolute bottom-14 right-3 z-10 rounded-lg bg-white/90 px-4 py-2 text-sm font-bold text-black shadow-lg">Skip {currentSeg.label}</button>
  {/if}

  <!-- Locked: only an unlock affordance -->
  {#if locked}
    {#if lockToggleShown}
      <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); toggleLock() }} class="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 grid h-14 w-14 place-items-center rounded-full bg-black/50 backdrop-blur" aria-label="Unlock"><Lock size={24} /></button>
    {/if}
  {:else if controlsShown}
    <div in:fade={{ duration: 180 }} class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/75"></div>

    <!-- Top bar -->
    <div in:fade={{ duration: 180 }} class="player-top-bar absolute inset-x-0 top-0 flex items-center gap-2 p-2 landscape:p-3" onclick={(e) => e.stopPropagation()} role="presentation">
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

    <!-- Center transport (morphing play/pause). While loading the centre glyph becomes a spinner in
         place — the row itself never disappears, so rewind/forward stay usable and the button keeps
         its hit target (you can still pause a stream that is still buffering). -->
    <div in:fade|global={{ duration: 180 }} class="pointer-events-none absolute inset-0 flex items-center justify-center gap-10">
      <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip(-$seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Rewind"><RotateCcw size={30} /></button>
      <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); pressPause() }} class="pointer-events-auto grid h-[68px] w-[68px] place-items-center rounded-full bg-white/15 backdrop-blur transition-transform active:scale-90" aria-label={loading ? 'Loading' : paused ? 'Play' : 'Pause'} aria-busy={loading}>
        {#if loading}
          <span in:fade={{ duration: 120 }} class="grid place-items-center">
            <BufferSpinner size={40} />
          </span>
        {:else}
          {#key paused}
            <span in:scale={{ duration: 160, start: 0.5 }} class="grid place-items-center">
              {#if paused}<Play size={38} class="ml-1" fill="currentColor" />{:else}<Pause size={38} fill="currentColor" />{/if}
            </span>
          {/key}
        {/if}
      </button>
      <button onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip($seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Forward"><RotateCw size={30} /></button>
    </div>

    <!-- Timeline sits on the actual bottom edge of the video, matching native mobile players. -->
    <div in:fade={{ duration: 180 }} class="player-timeline absolute inset-x-0 bottom-0 h-14" onclick={(e) => e.stopPropagation()} role="presentation">
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
        <!-- YouTube-style edge timeline: the track is flush with the video bottom and the centred
             thumb crosses that boundary. Portrait video overflow stays visible so it is not cut. -->
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
    <!-- The watch page is displaced by the expanded player's exact lower-edge growth. It dims only
         slightly; the player stays a bounded rectangle instead of bleeding through faded content. -->
    <section class="watch-details overflow-y-auto"
      style:transform={`translate3d(0, ${pullDetailsOffset}px, 0)`}
      style:opacity={1 - pullDim * 0.35}
      style:pointer-events={pullDim > 0 ? 'none' : null}>
      {#if $nowPlayingMedia}
        <AndroidWatchDetails
          media={$nowPlayingMedia.media}
          episode={np.episode}
          total={np.total}
          {hasPrev}
          {hasNext}
          onPrev={() => playPrev(undefined, !paused)}
          onNext={() => playNext(undefined, !paused)}
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
      <div class="flex items-center gap-2 px-4 pb-3">
        {#if settingsPage !== 'main'}
          <button onclick={() => (settingsPage = 'main')} class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10" aria-label="Back to video settings"><ChevronLeft size={21} /></button>
        {/if}
        <div class="min-w-0 flex-1"><h2 class="truncate text-lg font-extrabold">{settingsTitle()}</h2></div>
        <button onclick={dismissSettings} class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10" aria-label="Close"><X size={21} /></button>
      </div>
      <div class="settings-body overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {#if settingsPage === 'main'}
          <div class="overflow-hidden rounded-2xl bg-white/[0.07]">
            <button onclick={changeSource} class="settings-row"><Layers size={20} /><span class="flex-1 font-bold">Change source</span><ChevronRight size={18} class="text-white/35" /></button>
            <button onclick={() => (settingsPage = 'speed')} class="settings-row"><Gauge size={20} /><span class="flex-1 font-bold">Playback speed</span><span class="text-sm text-white/50">{speed}×</span><ChevronRight size={18} class="text-white/35" /></button>
            <button onclick={() => (settingsPage = 'display')} class="settings-row"><Ratio size={20} /><span class="flex-1 font-bold">Resize</span><span class="text-sm text-white/50">{FITS[fitIdx]}</span><ChevronRight size={18} class="text-white/35" /></button>
            <button onclick={() => (settingsPage = 'subtitles')} class="settings-row"><Captions size={20} /><span class="flex-1 font-bold">Subtitles</span><span class="max-w-28 truncate text-sm text-white/50">{selectedTrackLabel('sub')}</span><ChevronRight size={18} class="text-white/35" /></button>
            <button onclick={() => (settingsPage = 'audio')} class="settings-row"><Volume2 size={20} /><span class="flex-1 font-bold">Audio track</span><span class="max-w-28 truncate text-sm text-white/50">{selectedTrackLabel('audio')}</span><ChevronRight size={18} class="text-white/35" /></button>
            <button onclick={() => (settingsPage = 'capture')} class="settings-row"><Film size={20} /><span class="flex-1 font-bold">Capture</span><span class="text-sm text-white/50">GIF</span><ChevronRight size={18} class="text-white/35" /></button>
          </div>
          <button onclick={toggleLock} class="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3.5 text-left"><Lock size={20} /><span class="text-sm font-bold">{locked ? 'Unlock controls' : 'Lock controls'}</span></button>
        {:else if settingsPage === 'speed'}
          <div class="space-y-1">
            {#each SPEEDS as v (v)}
              <button onclick={() => setSpeed(v)} class="settings-choice {speed === v ? 'settings-choice-selected' : ''}"><span>{v}×</span>{#if speed === v}<Check size={18} />{/if}</button>
            {/each}
          </div>
        {:else if settingsPage === 'display'}
          <div class="space-y-1">
            {#each FITS as fit, i (fit)}
              <button onclick={() => setFit(i)} class="settings-choice {fitIdx === i ? 'settings-choice-selected' : ''}"><span>{fit}</span>{#if fitIdx === i}<Check size={18} />{/if}</button>
            {/each}
          </div>
        {:else if settingsPage === 'subtitles'}
          <button onclick={() => pickSub('no')} class="settings-choice {subOff ? 'settings-choice-selected' : ''}"><span>Off</span>{#if subOff}<Check size={18} />{/if}</button>
          {#each subTracks as track (track.id)}
            <button onclick={() => pickSub(track.id)} class="settings-choice {track.selected ? 'settings-choice-selected' : ''}"><span>{trackLabel(track)}</span>{#if track.selected}<Check size={18} />{/if}</button>
          {/each}
          <div class="mb-2 mt-5 flex items-center justify-between gap-3">
            <p class="text-xs font-bold uppercase tracking-wide text-white/50">Find more subtitles</p>
            <button disabled={$onlineSubCandidates.status === 'searching'} onclick={refreshOnlineSubtitles} class="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">{$onlineSubCandidates.status === 'searching' ? 'Searching…' : 'Search again'}</button>
          </div>
          {#if $subtitleNotice}<p class="mb-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/60">{$subtitleNotice}</p>{/if}
          {#each $onlineSubCandidates.items as candidate (candidateKey(candidate))}
            <button disabled={downloadingSubtitle === candidateKey(candidate)} onclick={() => addOnlineSub(candidate)} class="mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/10 disabled:opacity-50">
              <span class="min-w-0"><span class="block font-bold">{candidate.lang ?? 'und'} · {providerBadge(candidate.provider)}</span>{#if candidate.release}<span class="block truncate text-xs text-white/45">{candidate.release}</span>{/if}</span>
              <span class="shrink-0 text-xs text-white/50">{downloadingSubtitle === candidateKey(candidate) ? 'Loading…' : 'Add'}</span>
            </button>
          {:else}
            {#if $onlineSubCandidates.status === 'ready'}<p class="px-3 py-2 text-sm text-white/40">No additional subtitles found.</p>{/if}
          {/each}
        {:else if settingsPage === 'audio'}
          {#each audioTracks as track (track.id)}
            <button onclick={() => pickAudio(track.id)} class="settings-choice {track.selected ? 'settings-choice-selected' : ''}"><span>{trackLabel(track)}</span>{#if track.selected}<Check size={18} />{/if}</button>
          {:else}
            <p class="rounded-xl bg-white/[0.07] px-4 py-4 text-sm text-white/50">This stream only has its default audio track.</p>
          {/each}
        {:else if settingsPage === 'capture'}
          <button onclick={() => void toggleGifRecording()} disabled={gifBusy} class="flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-4 text-left disabled:opacity-50">
            {#if gifRecording}<span class="grid h-5 w-5 place-items-center"><span class="h-2.5 w-2.5 rounded-full bg-red-500"></span></span>{:else}<Film size={20} />{/if}
            <span class="text-sm font-bold">{gifBusy ? 'Working…' : gifRecording ? `Stop recording (${gifElapsed}s)` : 'Record GIF'}</span>
          </button>
          <button onclick={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} class="mt-2 flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-4 text-left">
            <span class="grid h-5 w-5 shrink-0 place-items-center rounded border {$gifIncludeSubtitles ? 'border-theme bg-theme text-white' : 'border-white/30'}">{#if $gifIncludeSubtitles}<Check size={14} />{/if}</span>
            <span class="min-w-0"><span class="block text-sm font-bold">Include subtitles</span><span class="block text-xs text-white/45">Record up to {GIF_MAX_SECONDS}s and save it to your gallery.</span></span>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .player-shell { touch-action: auto; background: transparent; }
  .video-frame { width: 100%; height: var(--portrait-player-height); margin-top: var(--player-safe-top); overflow: visible; z-index: 1; transform-origin: center; transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .watch-details { height: calc(100% - var(--player-safe-top) - var(--portrait-player-height)); touch-action: pan-y; background: #0a0a0b; transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .pulling-fullscreen .video-frame { will-change: transform; }
  .pulling-fullscreen .video-frame, .pulling-fullscreen .watch-details { transition: none; }
  .settings-backdrop { transition: opacity 240ms ease-out; }
  .settings-sheet { left: 0; right: 0; bottom: 0; max-height: 86%; border-radius: 1.25rem 1.25rem 0 0; transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform; }
  .settings-sheet.sheet-dragging { transition: none; }
  .settings-body { max-height: calc(86vh - 5.25rem); touch-action: pan-y; }
  .settings-row { display: flex; width: 100%; align-items: center; gap: 0.75rem; border-bottom: 1px solid rgb(255 255 255 / 0.08); padding: 0.9rem 1rem; text-align: left; font-size: 0.875rem; }
  .settings-row:last-child { border-bottom: 0; }
  .settings-row:active, .settings-choice:active { background: rgb(255 255 255 / 0.1); }
  .settings-choice { display: flex; width: 100%; align-items: center; justify-content: space-between; border-radius: 0.75rem; padding: 0.8rem 1rem; text-align: left; font-size: 0.875rem; }
  .settings-choice-selected { background: rgb(var(--theme-rgb, 239 42 89) / 0.18); color: var(--theme, #ef2a59); font-weight: 700; }

  @media (orientation: landscape) {
    .video-frame { width: 100%; height: 100%; margin-top: 0; aspect-ratio: auto; overflow: hidden; }
    .player-top-bar { padding-top: max(0.75rem, var(--player-safe-top)); padding-right: max(0.75rem, var(--player-safe-right)); padding-left: max(0.75rem, var(--player-safe-left)); }
    .player-timeline { left: max(3rem, calc(var(--player-safe-left) + 1.5rem), 6vw); right: max(3rem, calc(var(--player-safe-right) + 1.5rem), 6vw); bottom: max(2.5rem, calc(var(--player-safe-bottom) + 1.25rem)); height: 3.5rem; padding: 0; }
    .timeline-controls { padding: 0; }
    /* Landscape keeps the SAME bottom sheet as portrait — a full-width slide-up panel, not a side
       drawer. Only the height budget changes, because a landscape viewport is short. The side insets
       clear the display cutout, which sits on a long edge once the phone is rotated. */
    .settings-sheet { left: max(0px, var(--player-safe-left)); right: max(0px, var(--player-safe-right)); max-height: 90%; }
    .settings-body { max-height: calc(90vh - 5.25rem); padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
  }
</style>
