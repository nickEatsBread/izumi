<script lang="ts">
  // Touch-first overlay for the embedded Android libmpv player. Renders over the transparent
  // webview (video is the SurfaceView behind). Reuses izumi's play/track/aniskip plumbing.
  //
  // Interaction model (see docs/superpowers/specs/2026-07-15-android-player-rebuild-design.md):
  //   left/right thirds  — double-tap seek (by the seek-duration setting), vertical swipe = brightness/volume
  //   center             — single tap toggles controls, hold = temporary 2× speed
  //   horizontal drag    — live scrub anywhere over the video
  // A pure recognizer (android-gestures.ts) classifies each pointer stream; this component wires
  // its verdicts to mpv/native calls.
  import { onMount } from 'svelte'
  import { scale, fade } from 'svelte/transition'
  import {
    mpvState,
    androidMpvActive,
    mpvStop,
    mpvCommand,
    togglePause,
    seekAbsolute,
    seekKeyframe,
    seekRelative,
    setVolume,
    getVolume,
    haptic,
    grabThumb,
    mpvPip,
    getTracks,
    getChapters,
    setAudioTrack,
    setSubTrack,
    type MpvTrack,
  } from '$lib/player/android-mpv'
  import { zoneOf, classifyDrag, HOLD_MS, DOUBLE_TAP_MS } from '$lib/player/android-gestures'
  import { nowPlaying, nowPlayingMedia, streamPicker, commentsOpen } from '$lib/player/session'
  import { commentsEnabled } from '$lib/comments'
  import { autoSkip, seekDuration, scrubThumbnails } from '$lib/settings/ui'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { playNext, playPrev, playEpisode, finalizeAndroidWatch } from '$lib/stremio/play'
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import Play from 'lucide-svelte/icons/play'
  import Pause from 'lucide-svelte/icons/pause'
  import SkipBack from 'lucide-svelte/icons/skip-back'
  import SkipForward from 'lucide-svelte/icons/skip-forward'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'
  import RotateCw from 'lucide-svelte/icons/rotate-cw'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Captions from 'lucide-svelte/icons/captions'
  import Gauge from 'lucide-svelte/icons/gauge'
  import MessageSquare from 'lucide-svelte/icons/message-square'
  import Lock from 'lucide-svelte/icons/lock'
  import Ratio from 'lucide-svelte/icons/ratio'
  import Layers from 'lucide-svelte/icons/layers'
  import PictureInPicture from 'lucide-svelte/icons/picture-in-picture-2'
  import Sun from 'lucide-svelte/icons/sun'
  import Volume2 from 'lucide-svelte/icons/volume-2'

  let controlsShown = $state(true)
  let scrubbing = $state(false)
  let scrubPos = $state(0)
  let locked = $state(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let barEl: HTMLElement | undefined = $state()
  let rootEl: HTMLElement | undefined = $state()

  const pos = $derived(scrubbing ? scrubPos : $mpvState.pos)
  const dur = $derived($mpvState.dur)
  const paused = $derived($mpvState.paused)
  const loading = $derived($mpvState.buffering || dur === 0)
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
      getVolume().then((v) => { if (v > 0) volumeLevel = v }) // seed the volume shadow from mpv
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

  function armHide() { clearTimeout(hideTimer); if (!paused) hideTimer = setTimeout(() => (controlsShown = false), 3500) }
  function showControls() { controlsShown = true; armHide() }
  function toggleControls() { controlsShown = !controlsShown; if (controlsShown) armHide() }
  $effect(() => { if (paused) { clearTimeout(hideTimer); controlsShown = true } else if (controlsShown) armHide() })

  // --- Seek preview: one throttled keyframe seek per frame while dragging, exact seek on release ---
  function fracFromX(clientX: number) {
    if (!barEl) return 0
    const r = barEl.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  let rafId = 0
  let rafTarget = 0
  function schedulePreview(sec: number) {
    rafTarget = Math.max(0, dur > 0 ? Math.min(dur, sec) : sec)
    scrubPos = rafTarget
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; if (dur > 0) seekKeyframe(rafTarget) })
  }
  function endScrub() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    seekAbsolute(scrubPos) // land precisely
    scrubbing = false
  }
  function onBarDown(e: PointerEvent) {
    e.stopPropagation(); scrubbing = true; scrubPos = fracFromX(e.clientX) * dur
    barEl?.setPointerCapture(e.pointerId); showControls()
  }
  function onBarMove(e: PointerEvent) { if (scrubbing) schedulePreview(fracFromX(e.clientX) * dur) }
  function onBarUp(e: PointerEvent) {
    if (!scrubbing) return
    endScrub()
    try { barEl?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    armHide()
  }

  function skip(delta: number) {
    const target = Math.max(0, $mpvState.pos + delta)
    seekAbsolute(dur > 0 ? Math.min(dur, target) : target)
  }

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
  // Actual mpv seeks are coalesced to one relative seek per burst so rapid taps don't thrash the stream.
  const SEEK_MODE_MS = 650 // seek mode stays open this long after the last tap (DoubleTapPlayerView default)
  const SEEK_COMMIT_MS = 250 // debounce before the accumulated delta is actually seeked
  let seekFlash = $state<{ side: 'l' | 'r'; amt: number } | null>(null)
  let seekActive = false
  let seekSide: 'l' | 'r' | null = null
  let pendingDelta = 0
  let pendingToggle: ReturnType<typeof setTimeout> | undefined
  let firstTapSide: 'l' | 'r' | null = null
  let seekModeTimer: ReturnType<typeof setTimeout> | undefined
  let seekCommitTimer: ReturnType<typeof setTimeout> | undefined

  function commitSeek() {
    clearTimeout(seekCommitTimer); seekCommitTimer = undefined
    if (pendingDelta !== 0) { seekRelative(pendingDelta); pendingDelta = 0 }
  }
  function endSeekMode() {
    commitSeek()
    seekActive = false; seekSide = null; seekFlash = null
  }
  function armSeekTimers() {
    clearTimeout(seekCommitTimer); seekCommitTimer = setTimeout(commitSeek, SEEK_COMMIT_MS)
    clearTimeout(seekModeTimer); seekModeTimer = setTimeout(endSeekMode, SEEK_MODE_MS)
  }
  // One seek "tap" while in (or entering) seek mode: accumulate on the same side, reverse on the other.
  function bumpSeek(side: 'l' | 'r') {
    const step = $seekDuration
    if (seekActive && seekSide !== side) commitSeek() // reversing → flush the old direction first
    if (!seekActive || seekSide !== side) {
      seekActive = true; seekSide = side; seekFlash = { side, amt: step }
    } else {
      seekFlash = { side, amt: (seekFlash?.amt ?? 0) + step }
    }
    pendingDelta += side === 'r' ? step : -step
    haptic(15)
    armSeekTimers()
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
  type GestureKind = 'scrub' | 'brightness' | 'volume' | 'hold' | 'none' | null
  let gesture = $state<GestureKind>(null)
  let startSample = { x: 0, y: 0, t: 0 }
  let lastSample = { x: 0, y: 0, t: 0 }
  let scrubStartPos = 0
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let heldSpeed = false
  const VIDEO_SCRUB_SPAN = 90 // seconds spanned by a full-width horizontal drag over the video

  let volumeLevel = $state(100) // 0..100
  let hud = $state<{ icon: 'brightness' | 'volume'; pct: number } | null>(null)
  let hudTimer: ReturnType<typeof setTimeout> | undefined
  function showHud(icon: 'brightness' | 'volume', pct: number) {
    hud = { icon, pct: Math.round(pct) }
    clearTimeout(hudTimer); hudTimer = setTimeout(() => (hud = null), 700)
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  function onRootDown(e: PointerEvent) {
    if (locked) return
    rootEl?.setPointerCapture?.(e.pointerId)
    startSample = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    lastSample = { ...startSample }
    gesture = null
    holdTimer = setTimeout(() => { // press-and-hold in the center → temporary 2×
      if (gesture === null && zoneOf(startSample.x, window.innerWidth) === 'c') {
        gesture = 'hold'; heldSpeed = true; mpvCommand(['set', 'speed', '2']); flashToast('2× speed'); haptic(15)
      }
    }, HOLD_MS)
  }
  function onRootMove(e: PointerEvent) {
    if (locked || gesture === 'hold') return
    const cur = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    if (gesture === null) {
      const g = classifyDrag(startSample, cur, window.innerWidth, window.innerHeight)
      if (g.kind === 'pending') return
      clearTimeout(holdTimer)
      gesture = g.kind === 'scrub' || g.kind === 'volume' ? g.kind : 'none'
      lastSample = { ...startSample }
      if (gesture === 'scrub') { scrubbing = true; scrubStartPos = $mpvState.pos; showControls() }
    }
    if (gesture === 'volume') {
      volumeLevel = clamp(volumeLevel - ((cur.y - lastSample.y) / window.innerHeight) * 100, 0, 100)
      setVolume(volumeLevel); showHud('volume', volumeLevel); lastSample = cur
    } else if (gesture === 'scrub') {
      schedulePreview(scrubStartPos + ((cur.x - startSample.x) / window.innerWidth) * VIDEO_SCRUB_SPAN)
    }
  }
  function onRootUp(e: PointerEvent) {
    clearTimeout(holdTimer)
    if (heldSpeed) { heldSpeed = false; mpvCommand(['set', 'speed', String(speed)]); flashToast(`${speed}×`) }
    if (gesture === 'scrub') { endScrub(); armHide() }
    else if (gesture === null) onTap(e) // no drag happened → treat as a tap
    gesture = null
    try { rootEl?.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
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
  function cycleFit() {
    fitIdx = (fitIdx + 1) % 3
    if (fitIdx === 0) { mpvCommand(['set', 'keepaspect', 'yes']); mpvCommand(['set', 'panscan', '0']) }
    else if (fitIdx === 1) { mpvCommand(['set', 'keepaspect', 'yes']); mpvCommand(['set', 'panscan', '1.0']) }
    else { mpvCommand(['set', 'keepaspect', 'no']); mpvCommand(['set', 'panscan', '0']) }
    flashToast(`Resize: ${FITS[fitIdx]}`)
  }

  // --- Sheets ---
  type Sheet = null | 'quality' | 'speed'
  let sheet = $state<Sheet>(null)
  let tracks = $state<MpvTrack[]>([])
  const audioTracks = $derived(tracks.filter((t) => t.type === 'audio'))
  const subTracks = $derived(tracks.filter((t) => t.type === 'sub'))
  const subOff = $derived(!subTracks.some((t) => t.selected))
  async function openQuality() { clearTimeout(hideTimer); sheet = 'quality'; tracks = await getTracks() }
  function trackLabel(t: MpvTrack) { return [t.lang?.toUpperCase(), t.title].filter(Boolean).join(' · ') || `Track ${t.id}` }
  async function pickAudio(id: number) { await setAudioTrack(id); tracks = await getTracks() }
  async function pickSub(id: number | 'no') { await setSubTrack(id); tracks = await getTracks() }
  function changeSource() { sheet = null; const m = $nowPlayingMedia; if (m) playEpisode(m.media, m.episode, () => {}) }

  let speed = $state(1)
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; mpvCommand(['set', 'speed', String(v)]) }
  function openComments() { commentsOpen.set(true) }

  const overlayHidden = $derived($streamPicker != null || $commentsOpen)

  // Swipe-down on the sheet HANDLE to dismiss (kept off the scrollable body so it doesn't fight scroll).
  let sheetDrag = $state(0)
  let sheetStartY = 0
  function handleDown(e: PointerEvent) { sheetStartY = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  function handleMove(e: PointerEvent) { if (sheetStartY) sheetDrag = Math.max(0, e.clientY - sheetStartY) }
  function handleUp() { if (sheetDrag > 70) sheet = null; sheetDrag = 0; sheetStartY = 0 }

  async function close() {
    finalizeAndroidWatch($mpvState.pos, $mpvState.dur)
    await mpvStop().catch(() => {})
    androidMpvActive.set(false)
  }

  onMount(() => {
    armHide()
    return () => {
      clearTimeout(hideTimer); clearTimeout(pendingToggle); clearTimeout(seekModeTimer); clearTimeout(seekCommitTimer)
      clearTimeout(lockToggleTimer); clearTimeout(toastTimer); clearTimeout(hudTimer)
      clearTimeout(holdTimer); clearTimeout(thumbDebounce)
      if (rafId) cancelAnimationFrame(rafId)
    }
  })
</script>

<div bind:this={rootEl} class="fixed inset-0 z-50 select-none touch-none text-white" class:hidden={overlayHidden}
     onpointerdown={onRootDown} onpointermove={onRootMove} onpointerup={onRootUp} onpointercancel={onRootUp} role="presentation">
  <!-- Buffering shows a spinner INSTEAD of the play/pause transport, but only while playing — when
       paused, keep the play button so you can resume. -->
  {#if loading && !paused}
    <div class="pointer-events-none absolute inset-0 grid place-items-center"><Loader size={52} class="animate-spin text-white/90" /></div>
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

  {#if hud}
    <div class="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full bg-black/55 px-5 py-3 backdrop-blur">
      {#if hud.icon === 'brightness'}<Sun size={22} />{:else}<Volume2 size={22} />{/if}
      <div class="h-1.5 w-32 overflow-hidden rounded-full bg-white/25"><div class="h-full bg-white" style="width:{hud.pct}%"></div></div>
      <span class="w-8 text-right text-sm font-bold tabular-nums">{hud.pct}</span>
    </div>
  {/if}

  {#if toast}
    <div class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-5 py-2.5 text-sm font-bold backdrop-blur">{toast}</div>
  {/if}

  {#if currentSeg && !($autoSkip && !autoSkipped.has(currentSeg.start))}
    <button transition:fade={{ duration: 180 }} onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skipSegment() }} class="absolute bottom-32 right-4 z-10 rounded-lg bg-white/90 px-4 py-2.5 text-sm font-bold text-black shadow-lg">Skip {currentSeg.label}</button>
  {/if}

  <!-- Locked: only an unlock affordance -->
  {#if locked}
    {#if lockToggleShown}
      <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); toggleLock() }} class="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 grid h-14 w-14 place-items-center rounded-full bg-black/50 backdrop-blur" aria-label="Unlock"><Lock size={24} /></button>
    {/if}
  {:else if controlsShown}
    <div transition:fade={{ duration: 180 }} class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/75"></div>

    <!-- Top bar -->
    <div transition:fade={{ duration: 180 }} class="absolute inset-x-0 top-0 flex items-center gap-2 p-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} role="presentation">
      <button onclick={close} class="grid h-11 w-11 shrink-0 place-items-center rounded-full" aria-label="Back"><ChevronLeft size={28} /></button>
      <div class="min-w-0 flex-1">
        <div class="truncate text-base font-bold">{np.animeTitle ?? np.title}</div>
        {#if np.episode != null}<div class="truncate text-xs text-white/70">Episode {np.episode}{np.total ? ` / ${np.total}` : ''}</div>{/if}
      </div>
      <button onclick={() => { controlsShown = false; mpvPip() }} class="grid h-11 w-11 shrink-0 place-items-center rounded-full" aria-label="Picture in picture"><PictureInPicture size={22} /></button>
      {#if $commentsEnabled}
        <button onclick={openComments} class="grid h-11 w-11 shrink-0 place-items-center rounded-full" aria-label="Discussion"><MessageSquare size={22} /></button>
      {/if}
    </div>

    <!-- Center transport (morphing play/pause). Hidden while buffering-and-playing (spinner shows);
         always shown when paused so you can resume. -->
    {#if !loading || paused}
      <div transition:fade={{ duration: 180 }} class="pointer-events-none absolute inset-0 flex items-center justify-center gap-10">
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip(-$seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Rewind"><RotateCcw size={30} /></button>
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); togglePause() }} class="pointer-events-auto grid h-[68px] w-[68px] place-items-center rounded-full bg-white/15 backdrop-blur transition-transform active:scale-90" aria-label={paused ? 'Play' : 'Pause'}>
          {#key paused}
            <span in:scale={{ duration: 160, start: 0.5 }} class="grid place-items-center">
              {#if paused}<Play size={38} class="ml-1" fill="currentColor" />{:else}<Pause size={38} fill="currentColor" />{/if}
            </span>
          {/key}
        </button>
        <button onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); skip($seekDuration) }} class="pointer-events-auto grid h-12 w-12 place-items-center" aria-label="Forward"><RotateCw size={30} /></button>
      </div>
    {/if}

    <!-- Bottom: seek + labeled action row -->
    <div transition:fade={{ duration: 180 }} class="absolute inset-x-0 bottom-0 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="mb-2 flex items-center gap-3">
        <span class="w-14 text-right text-xs tabular-nums text-white/80">{fmt(pos)}</span>
        <div bind:this={barEl} class="relative h-7 flex-1 cursor-pointer touch-none" onpointerdown={onBarDown} onpointermove={onBarMove} onpointerup={onBarUp}
             role="slider" tabindex="0" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}>
          <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
            <div class="absolute inset-y-0 left-0 bg-white/40" style="width:{cachePct}%"></div>
            {#each segments as s (s.type + s.start)}
              <div class="absolute inset-y-0 {s.type === 'op' ? 'bg-sky-400/60' : s.type === 'ed' ? 'bg-fuchsia-400/60' : 'bg-amber-400/60'}" style="left:{(s.start / dur) * 100}%;width:{((s.end - s.start) / dur) * 100}%"></div>
            {/each}
            <div class="absolute inset-y-0 left-0 bg-theme" style="width:{playedPct}%"></div>
          </div>
          {#each chapters as c (c)}<div class="absolute top-1/2 h-1 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70" style="left:{(c / dur) * 100}%"></div>{/each}
          <div class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-theme shadow-md" style="left:{playedPct}%"></div>
          {#if scrubbing}
            <div class="pointer-events-none absolute bottom-6 flex -translate-x-1/2 flex-col items-center gap-1" style="left:{playedPct}%">
              {#if thumbUrl}<img src={thumbUrl} alt="" class="h-20 w-36 rounded-md border border-white/20 object-cover shadow-lg" />{/if}
              <span class="rounded bg-black/80 px-2 py-0.5 text-xs font-bold tabular-nums">{fmt(pos)}</span>
            </div>
          {/if}
        </div>
        <span class="w-14 text-xs tabular-nums text-white/80">{fmt(dur)}</span>
      </div>

      <div class="flex flex-wrap items-start justify-center gap-x-5 gap-y-2">
        <button onclick={() => playPrev()} disabled={!hasPrev} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium disabled:opacity-30" aria-label="Previous"><SkipBack size={22} /> Previous</button>
        <button onclick={toggleLock} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium"><Lock size={22} /> Lock</button>
        <button onclick={openQuality} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium"><Captions size={22} /> Quality & Subtitles</button>
        <button onclick={() => (sheet = 'speed')} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium"><Gauge size={22} /> Speed</button>
        <button onclick={cycleFit} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium"><Ratio size={22} /> Resize</button>
        <button onclick={() => playNext()} disabled={!hasNext} class="flex min-w-14 flex-col items-center gap-1 text-[11px] font-medium disabled:opacity-30" aria-label="Next"><SkipForward size={22} /> Next</button>
      </div>
    </div>
  {/if}

  <!-- Sheets -->
  {#if sheet}
    <div class="absolute inset-0 z-10 bg-black/50" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); sheet = null }} role="presentation"></div>
    <div class="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-neutral-900 pb-[calc(env(safe-area-inset-bottom)+1rem)]" style="transform:translateY({sheetDrag}px)" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} role="presentation">
      <!-- drag handle (only this dismisses on swipe, so the list scrolls normally) -->
      <div class="cursor-grab py-3 touch-none" onpointerdown={handleDown} onpointermove={handleMove} onpointerup={handleUp} role="presentation">
        <div class="mx-auto h-1 w-10 rounded-full bg-white/25"></div>
      </div>
      <div class="max-h-[60vh] overflow-y-auto px-4">
        {#if sheet === 'quality'}
          <button onclick={changeSource} class="mb-3 flex w-full items-center gap-3 rounded-lg bg-white/10 px-3 py-3 text-left text-sm font-bold hover:bg-white/15"><Layers size={20} /> Change source…</button>
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
        {:else if sheet === 'speed'}
          <p class="mb-3 text-xs font-bold uppercase tracking-wide text-white/50">Playback speed</p>
          <div class="flex flex-wrap gap-2 pb-2">
            {#each SPEEDS as v (v)}
              <button onclick={() => setSpeed(v)} class="rounded-full px-4 py-2 text-sm font-bold {speed === v ? 'bg-theme text-white' : 'bg-white/10 text-white/80'}">{v}×</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
