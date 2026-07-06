<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import Controls from './Controls.svelte'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { firstOccurrences } from '$lib/anime/animethemes'
  import { playing, nowPlaying, fullscreen, toggleFullscreen, exitFullscreen, playerNotice, spriteKey, bingeSource, gameMode } from '$lib/player/session'
  import { playPrev, playNext } from '$lib/stremio/play'
  import { autoSkip, seekDuration, videoFit, uiScale } from '$lib/settings/ui'
  import { get } from 'svelte/store'

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
  const controlsVisible = $derived(visible || paused || loading)
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
    cmd('set', ['cursor-autohide', controlsVisible ? 'no' : 'always'])
  })

  // Game mode (gamescope): gamescope won't blend the transparent webview over the video, so
  // mpv bakes a snapshot of the webview's UI onto the video via an overlay instead. Toggle it
  // whenever there's visible UI to show (controls / skip button / toast); the Rust side keeps
  // the snapshot refreshed at ~15fps while active. No effect off Linux/Game mode.
  const overlayActive = $derived(gmMode && $playing && (controlsVisible || showSkip || !!$playerNotice))
  $effect(() => {
    invoke('player_gm_overlay', { visible: overlayActive }).catch(() => {})
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
    poke()
    return () => {
      uns.forEach((u) => u.then((f) => f()))
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
     visible and clickable while playing. Cursor stays visible (mpv autohide off). -->
<div
  class="fixed inset-y-0 right-0 z-20 cursor-pointer"
  class:left-14={!$fullscreen && !gmMode}
  class:left-0={$fullscreen || gmMode}
  class:cursor-none={!controlsVisible}
  onclick={onOverlayTap}
  role="presentation"
>
  <!-- Loading/buffering. Black backdrop ONLY before the first frame (covers the
       white webview + the transparent hole). Mid-playback stalls show just the
       spinner over the frozen frame, with a 500ms fade-in so quick seeks don't
       flash a spinner (an anti-flash trick). -->
  {#if loading}
    <div
      transition:fade={{ duration: 150 }}
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      class:bg-black={!firstFrame}
    >
      <div
        in:fade={{ duration: 200, delay: firstFrame ? 500 : 0 }}
        class="size-12 animate-spin rounded-full border-4 border-white/25 border-t-white"
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
      class="absolute bottom-28 right-8 z-10 rounded-lg border border-white/20 bg-black/70 px-5 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-black/90"
      onclick={(e) => { e.stopPropagation(); seekTo(currentSeg.end + 0.5) }}
    >
      Skip {currentSeg.label}
    </button>
  {/if}

  {#if controlsVisible}
    <Controls {pos} {dur} {buffer} {paused} {segments} {chapters} {cmd} onclose={close} gm={gmMode} />
  {/if}
</div>
