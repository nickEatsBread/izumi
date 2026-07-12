<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import Controls from './Controls.svelte'
  import TrackMenu from './TrackMenu.svelte'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { firstOccurrences } from '$lib/anime/animethemes'
  import { playing, nowPlaying, fullscreen, toggleFullscreen, exitFullscreen, playerNotice, spriteKey, bingeSource, gameMode, trackMenuOpen, playerMenuOpen } from '$lib/player/session'
  import { playPrev, playNext } from '$lib/stremio/play'
  import { autoSkip, seekDuration, videoFit, uiScale } from '$lib/settings/ui'
  import { get } from 'svelte/store'
  import { initScrub, beginScrub, moveScrub, endScrub, scrub, scrubActive } from '$lib/player/scrub'
  import { startNativeGamepadSeek } from '$lib/player/gamepad'

  // In-app player overlay. mpv is embedded into the MAIN window (behind the
  // webview) by `player_embed`; this transparent overlay paints the controls on
  // top. No separate window. Playback events come from the Rust mpv event loop
  // (broadcast to this webview); the title/ids come from the `nowPlaying` store.
  const np = $derived($nowPlaying)

  let pos = $state(0)
  let dur = $state(0)
  let buffer = $state(0)
  let paused = $state(false)
  let buffering = $state(false)
  // Loading/stall composition (a readyState<3 analog). `coreIdle` starts
  // true so the black backdrop covers the white webview before the first frame.
  let coreIdle = $state(true)
  let seeking = $state(false)
  let eof = $state(false)
  let firstFrame = $state(false)
  let segments = $state<Segment[]>([])
  let chapters = $state<{ time: number; title: string }[]>([])
  let metaLoaded = false
  let loadedKey = ''
  // Segments already auto-skipped this episode (by start time), so seeking back
  // into one lets you actually watch it instead of being bounced out again.
  let autoSkipped = new Set<number>()
  // AnimeThemes: is this the episode where the OP/ED first debuts? If so we DON'T
  // auto-skip it, so the user hears each new theme once.
  let firstOcc = $state({ op: false, ed: false })

  let visible = $state(true)
  let hideT: ReturnType<typeof setTimeout>

  // Game mode (gamescope / Steam Deck): the video is a fullscreen layer-shell surface and the
  // transparent webview composites OVER it — so the player behaves EXACTLY like Desktop
  // fullscreen (controls FLOAT over live video, both visible at once). `gmMode` only drives
  // fullscreen chrome (no sidebar) + full-width overlay; there is no dock/swap. On the
  // touchscreen a tap reveals the (auto-hiding) controls; on Desktop a click toggles pause.
  const gmMode = $derived($gameMode)
  function onOverlayTap() {
    if (gmMode) poke()
    else cmd('cycle', ['pause'])
  }

  // ONE loading boolean, never sticky: true while bringing up the first frame, on
  // a cache stall, or mid-seek — but never while the user paused or at real EOF.
  const loading = $derived(!eof && !paused && (buffering || seeking || (coreIdle && (!firstFrame || pos > 0))))
  // Keep the controls in the DOM while scrubbing (even if the 3s auto-hide fired during a long
  // trigger hold) so the seek bar element stays measurable — otherwise the native scrub bar
  // loses its geometry and jumps to the fallback position lower on screen.
  const controlsVisible = $derived(visible || paused || loading || $scrubActive)
  const currentSeg = $derived(segments.find((s) => pos >= s.start && pos <= s.end))
  // A segment auto-skips only when the setting is on AND it's not the FIRST debut
  // of that OP/ED (per AnimeThemes). Recap always skips. When it WON'T auto-skip,
  // the manual Skip button is shown instead.
  const willSkip = (s: Segment) =>
    $autoSkip && !((s.type === 'op' && firstOcc.op) || (s.type === 'ed' && firstOcc.ed))
  const autoSkipCurrent = $derived(!!currentSeg && willSkip(currentSeg))

  // The manual Skip button shows for ~5s after entering an OP/ED segment, then hides
  // itself — unless the player controls are currently up (mouse active). Moving the
  // mouse (which shows the controls) brings it back.
  let skipTimer = $state(false)
  let skipT: ReturnType<typeof setTimeout>
  $effect(() => {
    if (currentSeg && !autoSkipCurrent) {
      skipTimer = true
      clearTimeout(skipT)
      skipT = setTimeout(() => (skipTimer = false), 5000)
    } else {
      skipTimer = false
      clearTimeout(skipT)
    }
    return () => clearTimeout(skipT)
  })
  const showSkip = $derived(!!currentSeg && !autoSkipCurrent && (skipTimer || controlsVisible))

  function poke() {
    visible = true
    clearTimeout(hideT)
    hideT = setTimeout(() => (visible = false), 3000)
  }
  function cmd(name: string, args: string[] = []) {
    invoke('player_command', { name, args }).catch((e) => console.warn('player_command', name, args, e))
  }
  // Exact absolute seek so auto-skip/skip land past the segment (a keyframe seek could
  // snap back into it and re-skip forever).
  const seekTo = (t: number) => cmd('seek', [Math.max(0, t).toFixed(3), 'absolute+exact'])

  // The shared scrub store commits through the same absolute seek as touch/skip.
  initScrub((t) => seekTo(t))

  // Game mode: read the Deck triggers (L2/R2) via the Rust backend while a video is playing
  // (the webview's own Gamepad API doesn't see the Deck controller under gamescope).
  $effect(() => {
    if (!gmMode || !$playing) return
    const stop = startNativeGamepadSeek({
      getPos: () => pos,
      getDur: () => dur,
      seek: (t) => seekTo(t),
      beginScrub: (t) => beginScrub(t, 'pad'),
      moveScrub: (t) => moveScrub(t),
      endScrub: () => endScrub(),
      onActivity: () => poke(),
    })
    return stop
  })

  async function close() {
    await exitFullscreen()
    playing.set(false)
    spriteKey.set(null)
    bingeSource.set(null)
    invoke('close_player').catch(() => {})
  }

  async function loadMeta() {
    metaLoaded = true
    segments = await getSkipSegments(np.malId, np.episode, dur)
    firstOcc = await firstOccurrences(np.id, np.episode)
    try {
      chapters = JSON.parse(await invoke<string>('player_chapters')) as { time: number; title: string }[]
    }
    catch { chapters = [] }
  }

  // Reset per-episode state whenever the now-playing target changes (new episode
  // via auto-advance), so nothing leaks and the next duration reloads AniSkip.
  $effect(() => {
    const key = `${np.title}|${np.episode}`
    if (key === loadedKey) return
    loadedKey = key
    pos = 0; dur = 0; buffer = 0; segments = []; chapters = []; metaLoaded = false
    coreIdle = true; seeking = false; eof = false; firstFrame = false
    autoSkipped = new Set()
    firstOcc = { op: false, ed: false }
  })

  // Auto-clear the transient overlay toast.
  $effect(() => {
    if (!$playerNotice) return
    const t = setTimeout(() => playerNotice.set(''), 3500)
    return () => clearTimeout(t)
  })

  // Apply the saved video fit once the first frame is up (and re-apply per episode).
  // 'fill' = mpv panscan 1 (crop to fill, aspect preserved — never stretched);
  // 'best' = panscan 0 (letterbox). keepaspect stays yes so quality is never distorted.
  $effect(() => {
    if (firstFrame) cmd('set', ['panscan', $videoFit === 'fill' ? '1.0' : '0.0'])
  })

  // Cursor hide over the video: the WebView2 overlay reports JS mousemove (so our idle
  // logic works) but passes the OS cursor (WM_SETCURSOR) through to mpv over the
  // transparent video — so CSS `cursor:none` doesn't reach it. Drive mpv's OWN cursor
  // from the idle state instead: shown while the controls are up, hidden when idle.
  $effect(() => {
    // Game mode is a touchscreen — never show a cursor over the video (mpv owns the cursor
    // there, so CSS can't reach it); keep it fully hidden. Desktop toggles it with the controls.
    cmd('set', ['cursor-autohide', gmMode ? 'always' : controlsVisible ? 'no' : 'always'])
  })

  // Game mode (gamescope): static HTML controls are snapshotted into mpv, but the moving
  // states that made the Deck hitch (loading + active scrub) are native mpv ASS overlays.
  // Bitmap overlays always sit above ASS in mpv, so the snapshot path is disabled while the
  // native dynamic overlay is active.
  const gmDynamicActive = $derived(gmMode && $playing && (loading || $scrubActive))
  // …and while the track menu is open, so its (webview-rendered) columns get snapshotted onto
  // the video — otherwise the menu would be invisible behind the opaque mpv surface.
  const overlayActive = $derived(gmMode && $playing && !gmDynamicActive && (controlsVisible || showSkip || !!$playerNotice || $trackMenuOpen || $playerMenuOpen))
  $effect(() => {
    // Faster snapshot cadence while ANY menu/popover is open so the highlight tracks d-pad moves
    // (the track menu OR the Controls playback-options / track popovers).
    invoke('player_gm_overlay', { visible: overlayActive, fast: $trackMenuOpen || $playerMenuOpen }).catch(() => {})
  })

  let gmDynRaf = 0
  let gmDynInFlight = false
  let gmDynDirty = false
  let gmDynDisposed = false
  let gmDynLastVisible = false
  // Last known seek bar geometry (CSS px), so the native scrub bar keeps its place if the
  // element is momentarily unmeasurable.
  let lastBar = { x: 0, y: 0, w: 0 }
  let gmScrubBasePos = $state(0)
  let gmScrubBaseBuffer = $state(0)
  let gmScrubWasActive = false

  $effect(() => {
    const active = gmMode && $scrub.active
    if (active && !gmScrubWasActive) {
      gmScrubBasePos = pos
      gmScrubBaseBuffer = buffer
    }
    gmScrubWasActive = active
  })

  // Game mode: PAUSE decode for the duration of an active skim, then resume on release. Unlike the
  // Electron reference (Chromium composites its DOM scrub bar on a separate thread, so it's smooth
  // even while playing), our bar is a native mpv OSD driven over IPC — while the video plays, the
  // Deck iGPU runs the libplacebo filter chain every frame AND mpv floods the WebKit main thread
  // with time-pos events, both of which starve the 60fps OSD redraw (which is why skimming is smooth
  // only when the video is already paused). Pausing frees the GPU + the event loop so the bar tracks
  // the finger smoothly. We only auto-resume if WE paused it (a user-initiated pause is preserved);
  // the exact seek still commits on release via endScrub. The frozen frame is fine — you're skimming.
  let scrubAutoPaused = false
  $effect(() => {
    if (!gmMode) return
    if ($scrub.active) {
      if (!paused && !scrubAutoPaused) { scrubAutoPaused = true; cmd('set', ['pause', 'yes']) }
    } else if (scrubAutoPaused) {
      scrubAutoPaused = false
      cmd('set', ['pause', 'no'])
    }
  })

  const gmScrubFreezesProgress = $derived(gmMode && $scrub.active)
  const gmDynamicPos = $derived(gmScrubFreezesProgress ? gmScrubBasePos : pos)
  const gmDynamicBuffer = $derived(gmScrubFreezesProgress ? gmScrubBaseBuffer : buffer)
  const controlsPos = $derived(gmScrubFreezesProgress ? $scrub.time : pos)
  const controlsBuffer = $derived(gmScrubFreezesProgress ? gmScrubBaseBuffer : buffer)

  const hiddenGmDynamicState = () => ({
    visible: false,
    loading: false,
    firstFrame: false,
    scrubbing: false,
    pos: 0,
    dur: 0,
    buffer: 0,
    scrubTime: 0,
    smoothScrub: false,
    padScrub: false,
    width: 1,
    height: 1,
    barX: 0,
    barY: 0,
    barW: 0,
    barH: 0,
  })

  function measureSeekBar() {
    const rect = document.querySelector('[aria-label="Seek"]')?.getBoundingClientRect()
    if (rect && rect.width > 0) lastBar = { x: rect.left, y: rect.top + rect.height / 2, w: rect.width }
  }

  function currentGmDynamicState() {
    const s = get(scrub)
    const visible = gmMode && get(playing) && (loading || s.active)
    // The player's own seek bar rect (CSS px). The native scrub bar is drawn here so it lands
    // exactly on top of the HTML bar — dragging feels like dragging the player's bar, not a
    // separate mini-skimmer. Measure it ONLY when NOT actively scrubbing: the bar is
    // geometrically constant during a drag, so re-reading getBoundingClientRect() every scrub
    // frame is a forced synchronous reflow 60x/s that jitters the very sample stream we then
    // smooth. Non-scrub frames (hover/loading) keep lastBar fresh; a one-time fallback covers a
    // scrub that starts before any measurement exists (the "drifts down" bug).
    if (!s.active || lastBar.w <= 0) measureSeekBar()
    return {
      visible,
      loading: visible && loading,
      firstFrame,
      scrubbing: visible && s.active,
      pos: gmDynamicPos,
      dur,
      buffer: gmDynamicBuffer,
      scrubTime: s.active ? s.time : pos,
      // Tween the native bar in the 60fps mpv OSD loop for BOTH input sources. Touch used to
      // snap to each IPC-delivered sample (mpv doesn't interpolate between osd-overlay pushes),
      // so it looked steppy; letting the OSD loop ease toward the latest target decouples visible
      // motion from IPC arrival rate — the chromium/compositor model. padScrub selects the tween
      // time-constant (longer for stepped triggers, short for a finger).
      smoothScrub: s.active,
      padScrub: s.source === 'pad',
      width: Math.max(1, window.innerWidth || 1),
      height: Math.max(1, window.innerHeight || 1),
      barX: lastBar.x,
      barY: lastBar.y,
      barW: lastBar.w,
      barH: 10,
    }
  }

  function scheduleGmDynamicOverlay() {
    if (typeof window === 'undefined' || gmDynDisposed || gmDynRaf) return
    if (!(gmMode && get(playing) && (loading || get(scrub).active)) && !gmDynLastVisible) return
    gmDynRaf = requestAnimationFrame(() => {
      gmDynRaf = 0
      if (gmDynInFlight) {
        gmDynDirty = true
        return
      }

      const state = currentGmDynamicState()
      if (!state.visible && !gmDynLastVisible) return
      gmDynInFlight = true
      gmDynLastVisible = state.visible
      invoke('player_gm_dynamic_overlay', { state })
        .catch(() => {})
        .finally(() => {
          gmDynInFlight = false
          if (gmDynDirty && !gmDynDisposed) {
            gmDynDirty = false
            scheduleGmDynamicOverlay()
          }
        })
    })
  }

  $effect(() => {
    gmMode; $playing; loading; firstFrame; gmDynamicPos; dur; gmDynamicBuffer; $scrub.active; $scrub.time; $scrub.source
    scheduleGmDynamicOverlay()
  })

  // NOTE: we intentionally KEEP accelerated compositing ON in Game mode. Forcing the software
  // (non-accelerated) path made menu text crisp but routed the base layer through WebKit's software
  // curve rasterizer, which aliases border-radius shapes (the play button circle looked pixelated).
  // Instead the menus are kept crisp by NOT promoting them to their own compositing layer (opaque
  // backgrounds, no will-change/translateZ) — see Controls.svelte + TrackMenu.svelte.

  // Game mode: lock document scroll while the player is up so a finger swipe on the video can't pan
  // the whole app into horizontal overflow (the "app slides/shrinks" bug). The browse page behind
  // is fully covered by the player anyway; scroll is restored on close.
  $effect(() => {
    if (!gmMode) return
    const el = document.documentElement
    const prev = el.style.overflow
    el.style.overflow = 'hidden'
    return () => { el.style.overflow = prev }
  })

  // Keep the screen awake ONLY while actively watching — inhibit the OS idle/screen-blank when
  // playing, release it when paused or at EOF (so the Deck's battery-saver can dim then). The
  // player closing (onDestroy below) releases it too, so browsing/paused screens dim normally.
  $effect(() => { invoke('set_idle_inhibit', { on: !paused && !eof }).catch(() => {}) })

  onDestroy(() => {
    gmDynDisposed = true
    if (gmDynRaf) cancelAnimationFrame(gmDynRaf)
    if (gmDynLastVisible) invoke('player_gm_dynamic_overlay', { state: hiddenGmDynamicState() }).catch(() => {})
    invoke('set_idle_inhibit', { on: false }).catch(() => {})
  })

  // Game mode controller: player-specific buttons (the app-wide nav translator leaves A/B/L1/R1
  // to us here so A can be context-aware). A = skip the intro/OP-ED when that button is showing,
  // else play/pause. B = leave the player (back to the series page). Episode changes are the
  // the L1/R1 bumpers, but only on a double-press (see padEpisode) so it can't fire accidentally.
  //
  // Episode change on a DOUBLE bumper press: first press arms + shows a hint, a second in the same
  // direction within the window commits. (A stray single press does nothing.)
  let padEpArm = 0
  let padEpDir: 1 | -1 = 1
  function padEpisode(dir: 1 | -1) {
    const now = performance.now()
    if (padEpArm && padEpDir === dir && now - padEpArm < 1400) {
      padEpArm = 0
      if (dir > 0) playNext(); else playPrev()
    } else {
      padEpArm = now
      padEpDir = dir
      playerNotice.set(dir > 0 ? 'Press again for the next episode' : 'Press again for the previous episode')
    }
  }

  $effect(() => {
    if (!gmMode || !$playing) return
    let un: (() => void) | null = null
    listen<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
      if (!e.payload.pressed) return
      // The track menu captures the pad while open — defer A/B/L1/R1 to it.
      if (get(trackMenuOpen)) return
      switch (e.payload.name) {
        case 'a':
          if (showSkip && currentSeg) seekTo(currentSeg.end + 0.5)
          else cmd('cycle', ['pause'])
          break
        case 'b':
          // Reveals the page underneath (the series page you launched from), NOT home —
          // the overlay never changed route, so closing is enough.
          close()
          break
        // L1/R1 change episode but only on a DOUBLE press (two quick taps of the same bumper) so a
        // stray press can't jump episodes. The first press arms + shows a hint.
        case 'l1': padEpisode(-1); break
        case 'r1': padEpisode(1); break
      }
    }).then((u) => { un = u })
    return () => un?.()
  })

  // TEMP diagnostic: log mpv's actual render-surface size vs the window on first frame,
  // so a "zoomed" render can be pinned to DPI (osd-width ≫ window×DPR) vs a size mismatch.
  let diagged = false
  $effect(() => {
    if (firstFrame && !diagged) {
      diagged = true
      invoke<string>('player_diag')
        .then((d) => console.log('[izumi diag] mpv:', d, '| window:', JSON.stringify({ iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio, uiScale: get(uiScale) })))
        .catch(() => {})
    }
  })

  // Auto-skip: seek past a segment the first time the playhead is inside it —
  // unless it's the OP/ED's debut episode (AnimeThemes). Tracked per-segment so a
  // manual seek-back isn't re-skipped.
  $effect(() => {
    const seg = currentSeg
    if (!seg || !willSkip(seg) || autoSkipped.has(seg.start)) return
    autoSkipped.add(seg.start)
    seekTo(seg.end + 0.5)
  })

  onMount(() => {
    const uns = [
      listen<[number, number]>('player-progress', (e) => {
        pos = e.payload[0]
        dur = e.payload[1]
        // First real frame shown → stop treating core-idle as "still loading".
        if (dur > 0 && !coreIdle) firstFrame = true
        if (!metaLoaded && dur > 0 && np.malId && np.episode) loadMeta()
      }),
      listen<number>('player-buffer', (e) => (buffer = e.payload)),
      listen<boolean>('player-paused', (e) => (paused = e.payload)),
      listen<boolean>('player-buffering', (e) => (buffering = e.payload)),
      listen<boolean>('player-core-idle', (e) => (coreIdle = e.payload)),
      listen<boolean>('player-seeking', (e) => (seeking = e.payload)),
      listen<boolean>('player-eof', (e) => (eof = e.payload)),
    ]
    // Safety net: end any active scrub on a window-level pointer release. If a seekbar drag
    // runs off the element/screen edge, its own pointerup can be missed — leaving the scrub
    // "active" forever, which pins the controls at opacity-0 (they vanish). Ending it here
    // guarantees recovery no matter where the finger lifts.
    const endStuckScrub = () => { if (get(scrub).active) endScrub() }
    window.addEventListener('pointerup', endStuckScrub)
    window.addEventListener('pointercancel', endStuckScrub)
    window.addEventListener('blur', endStuckScrub)
    poke()
    return () => {
      uns.forEach((u) => u.then((f) => f()))
      window.removeEventListener('pointerup', endStuckScrub)
      window.removeEventListener('pointercancel', endStuckScrub)
      window.removeEventListener('blur', endStuckScrub)
      clearTimeout(hideT)
    }
  })
</script>

<svelte:window
  onmousemove={poke}
  onkeydown={(e) => {
    poke()
    // Esc exits fullscreen (does NOT close the player — closing is the ← button).
    if (e.key === 'Escape') { if (get(fullscreen)) exitFullscreen() }
    else if (e.key === ' ' || e.key === 'k') cmd('cycle', ['pause'])
    // Arrow seeks are RELATIVE + EXACT: mpv computes the target from its OWN live
    // position (not a possibly-stale JS `pos`) and decodes to the exact frame — so a
    // repeated tap actually advances instead of looping the same keyframe/segment.
    else if (e.key === 'ArrowLeft') cmd('seek', [String(-get(seekDuration)), 'relative+exact'])
    else if (e.key === 'ArrowRight') cmd('seek', [String(get(seekDuration)), 'relative+exact'])
    else if (e.key === 'n' || e.key === 'N') playNext()
    else if (e.key === 'p' || e.key === 'P') playPrev()
    else if (e.key === 'f') toggleFullscreen()
  }}
/>

<!-- Transparent full-window overlay: mpv shows through, controls composite on top.
     z-20 keeps it below the sidebar nav (z-30) and titlebar (z-50), so those stay
     visible and clickable while playing. Cursor hides when the controls auto-hide over the
     video (and always in game mode). cursor-pointer/none are mutually exclusive so neither
     conflicting utility wins by stylesheet order. -->
<div
  class="fixed inset-y-0 right-0 z-20 touch-none overscroll-none select-none"
  class:cursor-pointer={!gmMode && controlsVisible}
  class:cursor-none={gmMode || !controlsVisible}
  class:left-14={!$fullscreen && !gmMode}
  class:left-0={$fullscreen || gmMode}
  onclick={onOverlayTap}
  role="presentation"
>
  <!-- Loading/buffering. Black backdrop ONLY before the first frame (covers the
       white webview + the transparent hole). Mid-playback stalls show just the
       spinner over the frozen frame, with a 500ms fade-in so quick seeks don't
       flash a spinner (an anti-flash trick). -->
  {#if loading && !gmMode}
    <div
      transition:fade={{ duration: 150 }}
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      class:bg-black={!firstFrame}
    >
      <!-- Game mode: stepped spin (8 frames/s) — a continuously-animating spinner makes every
           overlay snapshot differ, so the unchanged-frame skip never fires exactly when the
           device is busiest (buffering). Desktop keeps the smooth spin. -->
      <div
        in:fade={{ duration: 200, delay: firstFrame ? 500 : 0 }}
        class="size-12 animate-spin rounded-full border-4 border-white/25 border-t-white"
        style={gmMode ? 'animation-timing-function: steps(8)' : ''}
      ></div>
    </div>
  {/if}

  <!-- Transient toast (next-episode loading / errors). -->
  {#if $playerNotice}
    <div transition:fade={{ duration: 150 }} class="pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur">{$playerNotice}</div>
  {/if}

  <!-- Manual Skip button — shown when the current segment won't auto-skip (auto-skip
       off, or an OP/ED debut we intentionally don't auto-skip). Auto-hides after ~5s
       unless the controls are up. -->
  {#if showSkip && currentSeg}
    <button
      data-focusable
      transition:fade={{ duration: 150 }}
      class="absolute z-10 border border-white/20 bg-black/70 font-bold text-white backdrop-blur transition hover:bg-black/90
        {gmMode ? 'bottom-32 right-10 rounded-2xl px-9 py-5 text-2xl' : 'bottom-28 right-8 rounded-lg px-5 py-2.5 text-sm'}"
      onclick={(e) => { e.stopPropagation(); seekTo(currentSeg.end + 0.5) }}
    >
      Skip {currentSeg.label}
    </button>
  {/if}

  {#if controlsVisible}
    <div class:opacity-0={gmDynamicActive}>
      <Controls pos={controlsPos} {dur} buffer={controlsBuffer} {paused} {segments} {chapters} {cmd} onclose={close} gm={gmMode} />
    </div>
  {/if}

  <!-- Game mode: the ☰-button controller track menu (audio/subtitles). Mounted whenever in
       Game mode so it can catch the ☰ press; it renders its own overlay only while open. -->
  {#if gmMode}
    <TrackMenu {cmd} />
  {/if}
</div>
