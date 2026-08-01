<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { listen } from '@tauri-apps/api/event'
  import { listenSafe } from '$lib/util/listen'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import Controls from './Controls.svelte'
  import TrackMenu from './TrackMenu.svelte'
  import CommentsPanel from './CommentsPanel.svelte'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { mergeSkipSegments, segmentsFromChapters } from '$lib/player/chapter-skip'
  import { firstOccurrences } from '$lib/anime/animethemes'
  import { playing, playerLoadId, nowPlaying, nowPlayingMedia, nowPlayingStream, fullscreen, toggleFullscreen, exitFullscreen, pictureInPicture, togglePictureInPicture, exitPictureInPicture, playerNotice, spriteKey, bingeSource, gameMode, trackMenuOpen, playerMenuOpen, commentsOpen, playerSleep, playerStatsOpen, playerAbLoop, gifRecordingStart, directTorrentStats } from '$lib/player/session'
  import { playPrev, playNext, recoverPlaybackSource } from '$lib/stremio/play'
  import { markAlive } from '$lib/stremio/dead-sources'
  import {
    DIRECT_TORRENT_START_TIMEOUT_MS,
    recoveryWatchDecision,
    resetRecoveryWatch,
    type RecoveryWatchState,
  } from '$lib/player/recovery-watchdog'
  import {
    autoSkip, seekDuration, videoFit, uiScale, keepAwakeWhilePlaying,
    subtitleStyleEnabled, subtitleFont, subtitleFontSize, subtitleTextColor,
    subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition,
    subtitleAutoSync, gifIncludeSubtitles,
    hotkeyBindings, systemMediaControls, discordRichPresence,
  } from '$lib/settings/ui'
  import { get } from 'svelte/store'
  import { initScrub, beginScrub, moveScrub, endScrub, scrub, scrubActive } from '$lib/player/scrub'
  import { startNativeGamepadSeek } from '$lib/player/gamepad'
  import { discussionExpanded } from '$lib/comments'
  import { deckKeyboardWarning } from '$lib/deck/keyboard-warning'
  import { reportWatchPlayback } from '$lib/watch-together/client'
  import { currentDirectTorrentPlaybackId, directTorrentHealth, reportDirectTorrentBuffer, stopDirectTorrentPlayback } from '$lib/player/direct-torrent'
  import { autoSyncSelectedSubtitle, resetSubtitleSync, type SyncableTrack } from '$lib/player/subtitle-sync'
  import { subtitleStyleProps } from '$lib/player/subtitle-style'
  import { presenceDecision, type PresencePayload, type PresenceThrottleState } from '$lib/player/presence'
  import { findHotkey, isTypingTarget } from '$lib/hotkeys'
  import StatsOverlay from './StatsOverlay.svelte'
  import PictureInPicture from 'lucide-svelte/icons/picture-in-picture-2'
  import X from 'lucide-svelte/icons/x'
  import PlayIcon from 'lucide-svelte/icons/play'
  import PauseIcon from 'lucide-svelte/icons/pause'
  import PartyPresence from '$lib/components/watch/PartyPresence.svelte'

  // In-app player overlay. mpv is embedded into the MAIN window (behind the
  // webview) by `player_embed`; this transparent overlay paints the controls on
  // top. No separate window. Playback events come from the Rust mpv event loop
  // (broadcast to this webview); the title/ids come from the `nowPlaying` store.
  const np = $derived($nowPlaying)
  type NativeMediaAction = { action: string; value?: number }

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
  let loadedUrl = ''
  let recoveryWatch: RecoveryWatchState = resetRecoveryWatch(Date.now())
  let recoveryBusy = false
  let directTorrentDownloadedBytes = 0
  let directTorrentSelectedSize = 0
  let directTorrentHealthBusy = false
  let segments = $state<Segment[]>([])
  let chapters = $state<{ time: number; title: string }[]>([])
  let metaLoaded = false
  let loadedKey = ''
  let subtitleSyncKey = ''
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
  function onOverlayTap(e: MouseEvent) {
    // Clicks inside the discussion panel (links, filter pills) bubble up here — don't let them
    // toggle play/pause. The panel tags itself `data-comments-panel` instead of stopPropagation
    // (which would break Svelte's delegated button clicks). See CommentsPanel.svelte.
    if ((e.target as HTMLElement)?.closest?.('[data-comments-panel]')) return
    // A drag that ends over the window still delivers a click; moving the miniplayer must not
    // also pause it.
    if (pipDragged) { pipDragged = false; return }
    if (gmMode) poke()
    else cmd('cycle', ['pause'])
  }

  // Desktop miniplayer: picture-in-picture unmounts the whole app chrome, including the
  // titlebar that carries the window's only drag region — so the miniplayer had nothing left to
  // grab and sat wherever it was docked. Hand the press to the native window drag once the
  // pointer has actually travelled; a stationary press still falls through to the click above,
  // so tap-to-pause is unaffected.
  const PIP_DRAG_SLOP = 4
  let pipDragOrigin: { x: number; y: number } | null = null
  let pipDragged = false
  function pipDragDown(e: PointerEvent) {
    // Cleared here rather than after the drag: the native move loop can swallow both the pointerup
    // and the click, and a stale latch would eat the NEXT tap instead.
    pipDragged = false
    if (!$pictureInPicture || e.button !== 0 || !e.isPrimary) return
    // The overlay's own controls own their presses; dragging off a button would be a surprise.
    if ((e.target as HTMLElement)?.closest?.('button')) return
    pipDragOrigin = { x: e.clientX, y: e.clientY }
  }
  function pipDragMove(e: PointerEvent) {
    const origin = pipDragOrigin
    if (!origin) return
    if (
      Math.abs(e.clientX - origin.x) < PIP_DRAG_SLOP &&
      Math.abs(e.clientY - origin.y) < PIP_DRAG_SLOP
    ) return
    pipDragOrigin = null
    pipDragged = true
    void getCurrentWindow().startDragging().catch(() => { pipDragged = false })
  }
  function endPipDrag() { pipDragOrigin = null }

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
  function setLoopPoint(point: 'a' | 'b') {
    const loop = get(playerAbLoop)
    if (point === 'a') {
      playerAbLoop.set({ a: pos, b: null })
      cmd('set', ['ab-loop-a', pos.toFixed(3)])
      cmd('set', ['ab-loop-b', 'no'])
    } else if (loop.a != null && pos > loop.a + 0.25) {
      playerAbLoop.set({ a: loop.a, b: pos })
      cmd('set', ['ab-loop-b', pos.toFixed(3)])
    }
  }
  function clearLoop() {
    playerAbLoop.set({ a: null, b: null })
    cmd('set', ['ab-loop-a', 'no']); cmd('set', ['ab-loop-b', 'no'])
  }
  async function capture(kind: 'gif' | 'clip') {
    if (kind === 'gif') {
      if (get(gifRecordingStart) == null) {
        try {
          await invoke('player_gif_start', { includeSubtitles: $gifIncludeSubtitles })
          gifRecordingStart.set(pos)
          playerNotice.set('GIF recording started')
        } catch { playerNotice.set('GIF recording failed to start') }
        return
      }
      gifRecordingStart.set(null)
      try {
        await invoke('player_gif_stop')
        playerNotice.set('GIF saved to Pictures/izumi')
      } catch (error) {
        playerNotice.set(String(error).includes('ffmpeg-unavailable') ? 'GIF recording needs ffmpeg installed' : 'GIF recording failed')
      }
    } else {
      try {
        await invoke('player_capture_segment', { kind, startSec: Math.max(0, pos - 30), endSec: pos })
        playerNotice.set('Recent clip saved to Pictures/izumi')
      } catch { playerNotice.set('Clip capture failed') }
    }
  }

  // Controls auto-unmount when hidden, so the timer belongs to the persistent overlay.
  $effect(() => {
    const deadline = $playerSleep.deadline
    if (!deadline) return
    const finish = () => {
      if (Date.now() < deadline) return
      cmd('set', ['pause', 'yes'])
      playerSleep.set({ deadline: null, atEpisodeEnd: false })
      playerNotice.set('Sleep timer finished')
    }
    const timer = setInterval(finish, 1000)
    finish()
    return () => clearInterval(timer)
  })

  // Keep subtitle appearance live: settings changes apply to the current track immediately and
  // the same values are re-applied after every new player session.
  $effect(() => {
    if (!$playing) return
    for (const [property, value] of subtitleStyleProps({
      enabled: $subtitleStyleEnabled,
      font: $subtitleFont,
      fontSize: $subtitleFontSize,
      textColor: $subtitleTextColor,
      borderColor: $subtitleBorderColor,
      borderSize: $subtitleBorderSize,
      shadow: $subtitleShadow,
      position: $subtitlePosition,
    })) cmd('set', [property, value])
  })
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
    await exitPictureInPicture()
    playerSleep.set({ deadline: null, atEpisodeEnd: false })
    playerAbLoop.set({ a: null, b: null })
    if (get(gifRecordingStart) != null) await invoke('player_gif_abort').catch(() => {})
    gifRecordingStart.set(null)
    playerStatsOpen.set(false)
    playing.set(false)
    spriteKey.set(null)
    bingeSource.set(null)
    invoke('close_player').catch(() => {})
    invoke('desktop_presence_clear').catch(() => {})
  }

  // Desktop presence throttle. Plain `let`, NOT $state: the effect below both reads and writes it,
  // and a rune here would re-trigger the very effect that just scheduled the push (the known
  // self-write teardown hazard).
  let presenceThrottle: PresenceThrottleState | null = null
  const pushPresence = (payload: PresencePayload) =>
    void invoke('desktop_presence_update', { update: payload }).catch(() => {})

  // Publish playback to MPRIS/SMTC + Discord. EVERY field is read synchronously here so Svelte
  // tracks all of them — reading them inside the timeout instead meant the OS panel got exactly
  // one snapshot per episode (position frozen, settings toggles ignored mid-episode, Discord still
  // advertising an episode that was paused). Position moves ~4x/s, so only the playhead is rate
  // limited; a pause, a new episode or a settings change goes out at once.
  $effect(() => {
    const media = $nowPlayingMedia?.media
    // Parking on the last frame with auto-play off used to leave a stale "now playing" on the bus
    // for as long as the player stayed open — nothing else on this path retracts it.
    if (eof) {
      presenceThrottle = null
      void invoke('desktop_presence_clear').catch(() => {})
      return
    }
    const payload: PresencePayload = {
      title: np.title,
      series: np.animeTitle,
      episode: np.episode,
      duration: dur,
      position: pos,
      paused,
      coverUrl: media?.coverImage?.extraLarge ?? media?.coverImage?.medium ?? null,
      systemControls: $systemMediaControls,
      discord: $discordRichPresence,
      // `nowPlayingMedia` is set at the TOP of playStream() but `nowPlaying` only after the source
      // has resolved (seconds later, on the debrid path), so while a watch-together host switches
      // titles this effect can see the OUTGOING title next to the INCOMING isAdult flag. Treat a
      // mismatched pair as private: the panel shows the placeholder for the second it takes the
      // two stores to agree instead of publishing the previous (possibly adult) episode name.
      private: !!media?.isAdult || (media != null && np.id != null && media.id !== np.id),
      seekSeconds: $seekDuration,
    }
    const decision = presenceDecision(presenceThrottle, payload, Date.now())
    presenceThrottle = decision.state
    if (decision.send) { pushPresence(payload); return }
    // Progress ticks normally re-run this effect before the timer fires; it only matters when they
    // stop, so the final position still lands.
    const timer = setTimeout(() => {
      presenceThrottle = { signature: decision.state.signature, sentAt: Date.now() }
      pushPresence(payload)
    }, decision.waitMs)
    return () => clearTimeout(timer)
  })

  async function loadMeta() {
    metaLoaded = true
    // Every await below can outlive the episode/source it was started for. Snapshot the key and
    // drop the result if the reset effect has moved on, otherwise a slow AniSkip response lands on
    // the next episode and auto-skip jumps mid-scene to a timestamp from the previous file.
    const key = loadedKey
    // AniSkip and AnimeThemes run in parallel, and the debut guard is assigned BEFORE the segments
    // it guards: the auto-skip effect fires the instant `segments` lands, so assigning firstOcc
    // second leaves a window in which a debut opening gets skipped anyway.
    const [segs, occ] = await Promise.all([
      getSkipSegments(np.malId, np.episode, dur),
      firstOccurrences(np.id, np.episode),
    ])
    if (key !== loadedKey) return
    firstOcc = occ
    let ch: { time: number; title: string }[] = []
    try { ch = JSON.parse(await invoke<string>('player_chapters')) as { time: number; title: string }[] }
    catch { ch = [] }
    if (key !== loadedKey) return
    chapters = ch
    // AniSkip coverage is thin outside popular titles; well-tagged releases name their own chapters.
    // Chapter-derived segments carry the same op/ed type, so the debut guard covers them too.
    segments = mergeSkipSegments(segs, segmentsFromChapters(ch, dur))
  }

  // Reset per-episode state whenever the now-playing target changes (new episode
  // via auto-advance), so nothing leaks and the next duration reloads AniSkip.
  // `$spriteKey` is part of the key because "Change source" re-plays the SAME title+episode from a
  // different release: without it the reset is skipped and the new file inherits the old release's
  // chapters, AniSkip windows and `dur` — so auto-skip seeks to a timestamp that belongs to a file
  // that is no longer loaded. Seekbar already keys its thumbnails on the same store.
  $effect(() => {
    const key = `${$playerLoadId}|${np.title}|${np.episode}|${$spriteKey ?? ''}`
    if (key === loadedKey) return
    loadedKey = key
    pos = 0; dur = 0; buffer = 0; paused = false; segments = []; chapters = []; metaLoaded = false
    coreIdle = true; seeking = false; eof = false; firstFrame = false; loadedUrl = ''
    recoveryWatch = resetRecoveryWatch(Date.now())
    directTorrentDownloadedBytes = 0
    autoSkipped = new Set()
    firstOcc = { op: false, ed: false }
    playerAbLoop.set({ a: null, b: null })
    if (get(gifRecordingStart) != null) void invoke('player_gif_abort').catch(() => {})
    gifRecordingStart.set(null)
    subtitleSyncKey = ''
    resetSubtitleSync()
  })

  // mpv chooses the preferred subtitle during load, before the controls menu has ever opened.
  // Once duration is known, inspect that selected track and run the optional one-shot alignment.
  $effect(() => {
    const key = loadedKey
    if (!$subtitleAutoSync || dur < 60 || !key || subtitleSyncKey === key) return
    subtitleSyncKey = key
    void invoke<string>('player_tracks')
      .then((raw) => autoSyncSelectedSubtitle(JSON.parse(raw) as SyncableTrack[], dur))
      .catch(() => {})
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
  const overlayActive = $derived(gmMode && $playing && !gmDynamicActive && (controlsVisible || showSkip || !!$playerNotice || $trackMenuOpen || $playerMenuOpen || $commentsOpen))
  $effect(() => {
    // Faster snapshot cadence while ANY menu/popover is open so the highlight tracks d-pad moves
    // (the track menu OR the Controls playback-options / track popovers).
    invoke('player_gm_overlay', { visible: overlayActive, fast: $trackMenuOpen || $playerMenuOpen || $commentsOpen }).catch(() => {})
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

  // Keep the screen awake ONLY after a real video frame has appeared and playback is advancing.
  // The first-frame gate avoids inhibiting during the initial/next-episode loading screen.
  // Pause, EOF, player close, navigation away, or disabling the setting releases immediately.
  $effect(() => {
    const activelyWatching = $playing && firstFrame && !paused && !eof
    invoke('set_idle_inhibit', { on: $keepAwakeWhilePlaying && activelyWatching }).catch(() => {})
  })

  onDestroy(() => {
    // Close the discussion panel on every player-close path (← button, B, navigate-away) so the
    // desktop titlebar — which hides itself while commentsOpen — reappears once the player is gone.
    commentsOpen.set(false)
    // Hand the LAST position/duration to the progress tracker (play.ts) so closing right after a
    // skim-to-the-end still saves the resume point + marks watched — fires on every close path
    // (← button, B, navigate-away). play.ts's window listener is still live at this point.
    window.dispatchEvent(new CustomEvent('player-finalize', { detail: { pos, dur } }))
    void stopDirectTorrentPlayback()
    gmDynDisposed = true
    if (gmDynRaf) cancelAnimationFrame(gmDynRaf)
    if (gmDynLastVisible) invoke('player_gm_dynamic_overlay', { state: hiddenGmDynamicState() }).catch(() => {})
    invoke('set_idle_inhibit', { on: false }).catch(() => {})
    // Retract the OS media panel / Discord entry on EVERY teardown path, not just the ← button —
    // navigating away unmounts the overlay without ever running close().
    invoke('desktop_presence_clear').catch(() => {})
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
      if (dir > 0) playNext(undefined, !paused); else playPrev(undefined, !paused)
    } else {
      padEpArm = now
      padEpDir = dir
      playerNotice.set(dir > 0 ? 'Press again for the next episode' : 'Press again for the previous episode')
    }
  }

  $effect(() => {
    if (!gmMode || !$playing) return
    return listenSafe<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
      if (!e.payload.pressed) return
      if (get(deckKeyboardWarning)) return
      // The track menu captures the pad while open — defer A/B/L1/R1 to it.
      if (get(trackMenuOpen)) return
      // While comments are open, do not let controller presses seek, pause, or leave the player
      // behind the modal. B and Select/View close the discussion.
      if (get(commentsOpen)) {
        if (e.payload.name === 'b' || e.payload.name === 'select') commentsOpen.set(false)
        return
      }
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
        case 'select':
          discussionExpanded.set(true)
          commentsOpen.set(true)
          break
        case 'l1': padEpisode(-1); break
        case 'r1': padEpisode(1); break
      }
    })
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
        reportDirectTorrentBuffer(pos, buffer)
        reportWatchPlayback(pos, dur, paused, buffering)
        // First real frame shown → stop treating core-idle as "still loading".
        if (dur > 0 && !coreIdle) {
          const becameReady = !firstFrame
          firstFrame = true
          // FileLoaded identifies the URL this progress belongs to. The equality check prevents a
          // late event from the previous source rehabilitating the new source during a switch.
          if (becameReady && loadedUrl && loadedUrl === $nowPlayingStream.url) {
            markAlive({ infoHash: $nowPlayingStream.infoHash ?? undefined, url: loadedUrl })
          }
        }
        // No MAL id gate: AniSkip/AnimeThemes bail out on their own, and chapter-derived skip
        // segments (plus the seekbar's chapter ticks) work on any file that carries chapters.
        if (!metaLoaded && dur > 0) loadMeta()
      }),
      listen<number>('player-buffer', (e) => {
        buffer = e.payload
        reportDirectTorrentBuffer(pos, buffer)
      }),
      listen<boolean>('player-paused', (e) => { paused = e.payload; reportWatchPlayback(pos, dur, paused, buffering) }),
      // Report the stall immediately rather than on the next progress tick — a cache stall stops
      // progress events, so waiting for one would delay the room's buffer gate by the whole stall.
      listen<boolean>('player-buffering', (e) => { buffering = e.payload; reportWatchPlayback(pos, dur, paused, buffering) }),
      listen<boolean>('player-core-idle', (e) => (coreIdle = e.payload)),
      listen<string>('player-file-loaded', (e) => (loadedUrl = e.payload)),
      listen<boolean>('player-seeking', (e) => (seeking = e.payload)),
      listen<boolean>('player-eof', (e) => (eof = e.payload)),
      listen<NativeMediaAction>('native-media-control', (e) => {
        const value = Number(e.payload.value ?? 0)
        if (e.payload.action === 'play') cmd('set', ['pause', 'no'])
        else if (e.payload.action === 'pause') cmd('set', ['pause', 'yes'])
        else if (e.payload.action === 'toggle') cmd('cycle', ['pause'])
        else if (e.payload.action === 'next') playNext(undefined, !paused)
        else if (e.payload.action === 'previous') playPrev(undefined, !paused)
        else if (e.payload.action === 'stop') void close()
        else if (e.payload.action === 'seekBy') cmd('seek', [String(value), 'relative+exact'])
        else if (e.payload.action === 'setPosition') cmd('seek', [String(value), 'absolute+exact'])
      }),
    ]
    // Safety net: end any active scrub on a window-level pointer release. If a seekbar drag
    // runs off the element/screen edge, its own pointerup can be missed — leaving the scrub
    // "active" forever, which pins the controls at opacity-0 (they vanish). Ending it here
    // guarantees recovery no matter where the finger lifts.
    const endStuckScrub = () => { if (get(scrub).active) endScrub() }
    window.addEventListener('pointerup', endStuckScrub)
    window.addEventListener('pointercancel', endStuckScrub)
    window.addEventListener('blur', endStuckScrub)

    // The player OWNS these keys while it's open. Handle them in CAPTURE phase with
    // stopImmediatePropagation so they can never also reach the app-wide spatial nav (whose
    // window listener registered first, at app start) — otherwise a seek arrow would ALSO walk
    // focus onto the chrome (the back button, the sidebar logo) while the video plays.
    const onKeyCapture = (e: KeyboardEvent) => {
      // A focused text field (e.g. the "Search subtitles…" box) OWNS every key. Otherwise typing a
      // language like "spa[n]ish" / "ja[p]anese" fires n→next / p→prev — which re-resolves the
      // episode and pops the source picker ("change source search") — plus f→fullscreen, space/k→pause.
      // Capture-phase runs before the input's own handler, so this guard (not stopPropagation) is the fix.
      if (isTypingTarget(e.target)) return
      const action = findHotkey(e, get(hotkeyBindings), 'Player')
      if (!action) return
      if (get(deckKeyboardWarning)) return
      e.preventDefault(); e.stopImmediatePropagation()
      poke()
      if (action === 'playerClose') { if (get(fullscreen)) exitFullscreen() }
      else if (action === 'playerPlayPause') cmd('cycle', ['pause'])
      else if (action === 'playerSeekBack') cmd('seek', [String(-get(seekDuration)), 'relative+exact'])
      else if (action === 'playerSeekForward') cmd('seek', [String(get(seekDuration)), 'relative+exact'])
      else if (action === 'playerVolumeUp') cmd('add', ['volume', '5'])
      else if (action === 'playerVolumeDown') cmd('add', ['volume', '-5'])
      else if (action === 'playerMute') cmd('cycle', ['mute'])
      else if (action === 'playerSubtitleCycle') cmd('cycle', ['sid'])
      else if (action === 'playerSubDelayDown') cmd('add', ['sub-delay', '-0.1'])
      else if (action === 'playerSubDelayUp') cmd('add', ['sub-delay', '0.1'])
      else if (action === 'playerNextEpisode') playNext(undefined, !paused)
      else if (action === 'playerPreviousEpisode') playPrev(undefined, !paused)
      else if (action === 'playerFullscreen') toggleFullscreen()
      else if (action === 'playerScreenshot') invoke('player_screenshot')
        .then(() => playerNotice.set('Screenshot saved to Pictures/izumi'))
        .catch(() => playerNotice.set('Screenshot failed'))
      else if (action === 'playerStats') playerStatsOpen.update((value) => !value)
      else if (action === 'playerGif') void capture('gif')
      else if (action === 'playerClip') void capture('clip')
      else if (action === 'playerSleep') {
        const enabled = !get(playerSleep).atEpisodeEnd
        playerSleep.set({ deadline: null, atEpisodeEnd: enabled })
        playerNotice.set(enabled ? 'Sleep after this episode' : 'Sleep timer cleared')
      }
      else if (action === 'playerLoopA') setLoopPoint('a')
      else if (action === 'playerLoopB') setLoopPoint('b')
      else if (action === 'playerLoopClear') clearLoop()
    }
    window.addEventListener('keydown', onKeyCapture, true)
    const recoveryTimer = setInterval(() => {
      if (!$playing || recoveryBusy) return
      const directP2p = !!$nowPlayingStream.infoHash
        && /^http:\/\/127\.0\.0\.1:\d+\/torrents\//.test($nowPlayingStream.url)
      if (!directP2p) {
        directTorrentStats.set(null)
        directTorrentSelectedSize = 0
      }
      if (directP2p && !directTorrentHealthBusy) {
        const playbackId = currentDirectTorrentPlaybackId()
        directTorrentHealthBusy = true
        void directTorrentHealth()
          .then((health) => {
            if (currentDirectTorrentPlaybackId() !== playbackId) return
            directTorrentStats.set(health)
            if (health) {
              directTorrentDownloadedBytes = health.downloadedBytes
              directTorrentSelectedSize = health.selectedSize
            }
          })
          .finally(() => { directTorrentHealthBusy = false })
      }
      const decision = recoveryWatchDecision(recoveryWatch, {
        now: Date.now(),
        position: pos,
        duration: dur,
        paused,
        buffering,
        seeking,
        eof,
        firstFrame,
        startTimeoutMs: directP2p ? DIRECT_TORRENT_START_TIMEOUT_MS : undefined,
        networkBytes: directP2p ? directTorrentDownloadedBytes : undefined,
        minimumStartupBytesPerSecond: directP2p && $nowPlayingMedia?.media.duration && directTorrentSelectedSize > 0
          ? directTorrentSelectedSize / ($nowPlayingMedia.media.duration * 60) * 0.5
          : undefined,
      })
      recoveryWatch = decision.state
      if (!decision.recover) return
      recoveryBusy = true
      void recoverPlaybackSource(
        pos,
        !paused,
        directP2p ? 'P2P source is too slow — trying a healthier torrent…' : undefined,
      )
        .catch((error) => {
          console.warn('automatic playback recovery', error)
          playerNotice.set('Automatic source recovery failed')
        })
        .finally(() => { recoveryBusy = false })
    }, 1_000)
    poke()
    return () => {
      uns.forEach((u) => u.then((f) => f()))
      window.removeEventListener('pointerup', endStuckScrub)
      window.removeEventListener('pointercancel', endStuckScrub)
      window.removeEventListener('blur', endStuckScrub)
      window.removeEventListener('keydown', onKeyCapture, true)
      clearInterval(recoveryTimer)
      clearTimeout(hideT)
    }
  })
</script>

<!-- Arrow seeks are RELATIVE + EXACT (mpv computes from its OWN live position, so a repeated tap
     advances instead of looping a keyframe). Keys are handled by the CAPTURE-phase listener in
     onMount (above) — NOT here — so they never leak to the spatial nav and move focus. -->
<svelte:window onmousemove={poke} />

<!-- Transparent full-window overlay: mpv shows through, controls composite on top.
     z-20 keeps it below the sidebar nav (z-30) and titlebar (z-50), so those stay
     visible and clickable while playing. Cursor hides when the controls auto-hide over the
     video (and always in game mode). cursor-pointer/none are mutually exclusive so neither
     conflicting utility wins by stylesheet order. -->
<div
  class="fixed inset-y-0 right-0 z-20 overscroll-none select-none"
  class:touch-none={!$commentsOpen}
  class:touch-auto={$commentsOpen}
  class:cursor-pointer={!gmMode && controlsVisible}
  class:cursor-none={gmMode || !controlsVisible}
  class:left-14={!$fullscreen && !gmMode && !$pictureInPicture}
  class:left-0={$fullscreen || gmMode || $pictureInPicture}
  onclick={onOverlayTap}
  onpointerdown={pipDragDown}
  onpointermove={pipDragMove}
  onpointerup={endPipDrag}
  onpointercancel={endPipDrag}
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

  {#if $playerStatsOpen}<StatsOverlay />{/if}
  {#if !$pictureInPicture}<PartyPresence floating />{/if}

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

  {#if controlsVisible && $pictureInPicture}
    <div class="pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/80 p-3 text-white">
      <div class="flex min-w-0 items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-black">{np.animeTitle}</p>
          <p class="truncate text-xs text-white/65">{np.episode != null ? `Episode ${np.episode}` : np.title}</p>
        </div>
        <button data-focusable onclick={(event) => { event.stopPropagation(); togglePictureInPicture() }}
                class="pointer-events-auto grid size-8 place-items-center rounded-full bg-black/50" aria-label="Exit picture in picture">
          <PictureInPicture size={16} />
        </button>
        <button data-focusable onclick={(event) => { event.stopPropagation(); close() }}
                class="pointer-events-auto grid size-8 place-items-center rounded-full bg-black/50" aria-label="Close player">
          <X size={17} />
        </button>
      </div>
      <div class="flex items-center gap-3">
        <button data-focusable onclick={(event) => { event.stopPropagation(); cmd('cycle', ['pause']) }}
                class="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-full bg-white text-black" aria-label={paused ? 'Play' : 'Pause'}>
          {#if paused}<PlayIcon size={20} fill="currentColor" />{:else}<PauseIcon size={20} fill="currentColor" />{/if}
        </button>
        <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/25">
          <div class="h-full bg-theme" style="width:{dur > 0 ? Math.min(100, pos / dur * 100) : 0}%"></div>
        </div>
        <span class="text-[0.65rem] tabular-nums text-white/70">{Math.floor(pos / 60)}:{String(Math.floor(pos % 60)).padStart(2, '0')}</span>
      </div>
    </div>
  {:else if controlsVisible}
    <div class:opacity-0={gmDynamicActive}>
      <Controls pos={controlsPos} {dur} buffer={controlsBuffer} {paused} {segments} {chapters} {cmd} onclose={close} gm={gmMode} />
    </div>
  {/if}

  <!-- Game mode: the ☰-button controller track menu (audio/subtitles). Mounted whenever in
       Game mode so it can catch the ☰ press; it renders its own overlay only while open. -->
  {#if gmMode}
    <TrackMenu {cmd} />
  {/if}

  <!-- Discussion panel: self-gates on `commentsOpen`. Keyed on the playing episode. -->
  {#if !$pictureInPicture}<CommentsPanel />{/if}
</div>
