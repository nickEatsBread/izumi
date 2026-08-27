<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { playerCommand, playerGetProperty, playerGifStart, playerGifStop, playerScreenshot, playerTracks } from '$lib/player/native'
  import { listen } from '@tauri-apps/api/event'
  import { onMount } from 'svelte'
  import type { Segment } from '$lib/stremio/aniskip'
  import Seekbar from './Seekbar.svelte'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import VolumeX from '@lucide/svelte/icons/volume-x'
  import Captions from '@lucide/svelte/icons/captions'
  import MessageSquare from '@lucide/svelte/icons/message-square'
  import Maximize from '@lucide/svelte/icons/maximize'
  import Minimize from '@lucide/svelte/icons/minimize'
  import Settings from '@lucide/svelte/icons/settings-2'
  import SkipBack from '@lucide/svelte/icons/skip-back'
  import SkipForward from '@lucide/svelte/icons/skip-forward'
  import Camera from '@lucide/svelte/icons/camera'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Check from '@lucide/svelte/icons/check'
  import Languages from '@lucide/svelte/icons/languages'
  import Search from '@lucide/svelte/icons/search'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left'
  import PictureInPicture from '@lucide/svelte/icons/picture-in-picture-2'
  import { get } from 'svelte/store'
  import { fullscreen, toggleFullscreen, togglePictureInPicture, nowPlaying, nowPlayingUrl, nowPlayingStream, playerNotice, playerMenuOpen, playerSideSheetOpen, nowPlayingMedia, commentsOpen, subtitleNotice, onlineSubCandidates, torrentSubtitleState, nextEpisodeReady, playerStatsOpen, playerSleep, playerAbLoop, gifRecordingStart, playbackRecovery, bumpPlayerOverlay } from '$lib/player/session'
  import { listenSafe } from '$lib/util/listen'
  import { deckKeyboardWarning } from '$lib/deck/keyboard-warning'
  import { copyToClipboard } from '$lib/util/clipboard'
  import Wrench from '@lucide/svelte/icons/wrench'
  import { discussionExpanded } from '$lib/comments'
  import { videoFit, playerTitleTop, openSubtitlesToken, subtitleAutoSync, secondarySubtitles, subtitleLineNavigation, gifIncludeSubtitles } from '$lib/settings/ui'
  import { playPrev, playNext, playEpisode, playStream, searchOnlineSubtitles } from '$lib/stremio/play'
  import { serverSiblings, variantLabels } from '$lib/player/source-variants'
  import type { Stream } from '$lib/stremio/addon'
  import type { SubtitleCandidate } from '$lib/stremio/subtitles/types'
  import { trackLabel } from '$lib/player/track-label'
  import { providerBadge, candidateTitle, candidateKey, isCandidateLoaded, subtitleErrorNotice, candidateApiKey, candidateDownloadUrl } from './online-subs'
  import { autoSyncSelectedSubtitle } from '$lib/player/subtitle-sync'
  import { captureFromExtradata } from '$lib/player/ass-style-capture'
  import { savedSubtitleStyles, sessionSubtitleStyle, saveSubtitlePreset, subtitlePresetSourceName } from '$lib/settings/subtitle-presets'
  import { bingeSource } from '$lib/player/session'
  import Brush from '@lucide/svelte/icons/brush'
  import { chapters as chapterStore } from '$lib/player/session'
  import { activeChapterIndex, formatChapterTime, isGenericChapterTitle } from '$lib/player/chapters'

  const np = $derived($nowPlaying)
  const hasPrev = $derived(np.episode != null && np.episode > 1)
  const hasNext = $derived(np.episode != null && np.airedTotal != null && np.episode < np.airedTotal)
  // Ready means THIS show's next episode specifically — a stale entry from another title must not
  // light the dot.
  const nextReady = $derived(
    !!$nextEpisodeReady && $nextEpisodeReady.mediaId === np.id && $nextEpisodeReady.episode === (np.episode ?? 0) + 1,
  )

  // `cmd` runs an mpv command; the page owns the invoke plumbing + live state.
  let {
    pos,
    dur,
    buffer,
    paused,
    segments,
    cmd,
    onclose,
    gm = false,
    native = false,
    ontoggleplay,
    oneditsubtitles,
    onscrubinput,
  }: {
    pos: number
    dur: number
    buffer: number
    paused: boolean
    segments: Segment[]
    cmd: (name: string, args?: string[]) => void
    onclose: () => void
    // Game mode (Deck/gamescope touch player): no windowed/fullscreen toggle, and the
    // play button must swap the fullscreen video back in (not just unpause under a black
    // screen). `ontoggleplay` overrides the default cycle-pause when provided.
    gm?: boolean
    // Gamescope/XWayland paints these Game-mode controls through native ASS/bitmap chrome.
    // Native Wayland keeps the same Deck layout but renders this HTML live.
    native?: boolean
    ontoggleplay?: () => void
    oneditsubtitles?: () => void
    onscrubinput?: () => void
  } = $props()
  const togglePlay = () => (ontoggleplay ? ontoggleplay() : cmd('cycle', ['pause']))
  function toggleComments() {
    const opening = !$commentsOpen
    // The docked desktop sheet is too narrow at handheld distance. Open directly into the large
    // centered view on Steam Deck; desktop keeps the user's current expanded/docked preference.
    if (opening && gm) discussionExpanded.set(true)
    commentsOpen.set(opening)
    showOptions = false
    showTracks = false
    showServers = false
  }

  // Game mode (Deck) scales the controls up for a touchscreen at arm's length: bigger
  // secondary icon buttons + icons, and the title can move to the top of the player.
  const iconBtn = $derived(gm
    ? 'grid size-12 place-items-center rounded-full bg-white/10 transition-[transform,background-color] duration-150 ease-out hover:bg-white/20'
    : 'grid size-10 place-items-center rounded-full transition hover:bg-white/15')
  const icSize = $derived(gm ? 24 : 20)
  const titleTop = $derived(gm && $playerTitleTop)

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const mm = h ? String(m).padStart(2, '0') : `${m}`
    return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
  }

  // Commit a single EXACT absolute seek — lands where the user clicked instead of
  // snapping back to the previous keyframe (the "seeks a bit backwards" bug). One
  // seek, not a stream, so mpv doesn't loop over the cached window.
  const seekTo = (t: number) => {
    cmd('seek', [t.toFixed(3), 'absolute+exact'])
    if (native) bumpPlayerOverlay()
  }

  // Game mode: changing episode needs a DOUBLE press (touch double-tap, or two quick A presses on
  // the controller) so a stray tap can't jump episodes. The first press arms + shows a hint; a
  // second in the same direction within the window commits. Desktop keeps single-click.
  let epArm = 0
  let epArmDir: 1 | -1 = 1
  function episodeStep(dir: 1 | -1) {
    const now = performance.now()
    if (epArm && epArmDir === dir && now - epArm < 1400) {
      epArm = 0
      if (dir > 0) playNext(undefined, !paused); else playPrev(undefined, !paused)
    } else {
      epArm = now
      epArmDir = dir
      playerNotice.set(dir > 0 ? 'Press again for the next episode' : 'Press again for the previous episode')
    }
  }

  // Playback options menu (speed / fit / delays / subtitle size).
  let showOptions = $state(false)
  let speed = $state(1)
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; cmd('set', ['speed', String(v)]) }
  type QualityInfo = { mode: 'auto' | number; activeHeight: number; heights: number[] }
  let qualityInfo = $state<QualityInfo>({ mode: 'auto', activeHeight: 0, heights: [] })
  function applyQualityInfo(value: unknown) {
    if (!value || typeof value !== 'object') return
    const raw = value as Partial<QualityInfo>
    const heights = Array.isArray(raw.heights)
      ? raw.heights.map(Number).filter((height) => Number.isFinite(height) && height > 0).sort((a, b) => b - a)
      : []
    if (!heights.length) return
    const selected = raw.mode === 'auto' ? 'auto' : Number(raw.mode)
    qualityInfo = {
      mode: selected === 'auto' || heights.includes(selected) ? selected : 'auto',
      activeHeight: Number(raw.activeHeight) || 0,
      heights,
    }
  }
  async function readVideoQualities() {
    try { applyQualityInfo(JSON.parse(await playerGetProperty('video-quality-options'))) }
    catch { qualityInfo = { mode: 'auto', activeHeight: 0, heights: [] } }
  }
  let gmSettingsPage = $state<'root' | 'speed' | 'quality' | 'fit' | 'tools'>('root')
  let gmSetIdx = $state(0)
  function toggleOptions() {
    showOptions = !showOptions
    showTracks = false
    showServers = false
    gmSettingsPage = 'root'
    gmSetIdx = 0
    bumpPlayerOverlay()
    if (showOptions) {
      readDelays()
      void readVideoQualities()
    }
  }
  function closePlayerMenus() {
    showOptions = false
    showTracks = false
    showServers = false
    gmSettingsPage = 'root'
    gmSetIdx = 0
  }
  function openSubtitleEditor() {
    closePlayerMenus()
    oneditsubtitles?.()
  }
  const gmRootKeys = $derived(['source', 'speed', ...(qualityInfo.heights.length ? ['quality'] : []), 'fit', 'subtitles', 'tools'] as string[])
  function gmRowCount() {
    if (gmSettingsPage === 'root') return gmRootKeys.length
    if (gmSettingsPage === 'speed') return 1 + speeds.length
    if (gmSettingsPage === 'quality') return 2 + qualityInfo.heights.length
    if (gmSettingsPage === 'fit') return 3
    return 6
  }
  function gmMove(delta: number) {
    const n = gmRowCount()
    if (!n) return
    gmSetIdx = (gmSetIdx + delta + n) % n
    bumpPlayerOverlay()
  }
  function gmOpenPage(page: typeof gmSettingsPage) {
    gmSettingsPage = page
    gmSetIdx = 0
    bumpPlayerOverlay()
  }
  function gmBack() {
    if (gmSettingsPage !== 'root') {
      gmOpenPage('root')
      return
    }
    closePlayerMenus()
    bumpPlayerOverlay()
  }
  function gmActivate() {
    if (gmSettingsPage === 'root') {
      const key = gmRootKeys[gmSetIdx]
      if (key === 'source') changeSource()
      else if (key === 'speed') gmOpenPage('speed')
      else if (key === 'quality') gmOpenPage('quality')
      else if (key === 'fit') gmOpenPage('fit')
      else if (key === 'subtitles') openSubtitleEditor()
      else if (key === 'tools') gmOpenPage('tools')
      return
    }
    if (gmSetIdx === 0) { gmBack(); return }
    const i = gmSetIdx - 1
    if (gmSettingsPage === 'speed') setSpeed(speeds[i] ?? 1)
    else if (gmSettingsPage === 'quality') {
      if (i === 0) void setVideoQuality('auto')
      else void setVideoQuality(qualityInfo.heights[i - 1] ?? 'auto')
    } else if (gmSettingsPage === 'fit') setFit(i === 0 ? 'best' : 'fill')
    else if (gmSettingsPage === 'tools') {
      if (i === 0) playerStatsOpen.update((value) => !value)
      else if (i === 1) setSleep('off')
      else if (i === 2) setSleep('15')
      else if (i === 3) setSleep('30')
      else setSleep('end')
    }
    bumpPlayerOverlay()
  }
  async function setVideoQuality(mode: 'auto' | number) {
    qualityInfo = { ...qualityInfo, mode }
    await playerCommand('set', ['video-quality', String(mode)]).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 100))
    await readVideoQualities()
  }
  // Subtitle/audio delay + subtitle scale, adjusted from the options popover. mpv holds the real
  // values; we read them so the menu shows a live number — otherwise a press looks like a no-op.
  // After a press we await the `add`, then re-read, so the number reflects what mpv actually applied
  // (a stuck value would expose a real failure instead of hiding it). Read on popover open too.
  let delays = $state<Record<string, number>>({ 'sub-delay': 0, 'audio-delay': 0, 'sub-scale': 1 })
  async function readProp(prop: string) {
    try {
      const v = parseFloat(await playerGetProperty(prop))
      if (!Number.isNaN(v)) delays[prop] = v
    } catch { /* no player / not loaded — keep the last value */ }
  }
  const readDelays = () => { for (const p of ['sub-delay', 'audio-delay', 'sub-scale']) readProp(p) }
  async function adjust(prop: string, delta: number) {
    await playerCommand('add', [prop, String(delta)]).catch(() => {})
    await readProp(prop)
  }
  async function resetProp(prop: string) {
    await playerCommand('set', [prop, prop === 'sub-scale' ? '1' : '0']).catch(() => {})
    await readProp(prop)
  }
  // sub-delay/audio-delay show as signed seconds (+0.3s / 0.0s); sub-scale as a multiplier (1.20×).
  const fmtDelay = (prop: string, v: number) =>
    prop === 'sub-scale' ? `${v.toFixed(2)}×` : `${v > 0 ? '+' : ''}${v.toFixed(1)}s`

  // Change source: re-open the source picker for the CURRENTLY-playing episode. Picking a new
  // source swaps the stream in place (playStream loads it into the running player).
  function changeSource() {
    showOptions = false
    const np = get(nowPlayingMedia)
    if (np) {
      playEpisode(np.media, np.episode, () => {}, {
        forceManual: true,
        // Picking a replacement source is an explicit "play this": always start it. Carrying the
        // old pause state over meant a source changed while paused loaded a file that just sat
        // there — read-ahead filling the buffer bar while nothing ever started.
        autoplay: true,
      })
    }
  }

  // Sibling-source switching (online providers): the candidate pool retained for watchdog
  // recovery (playbackRecovery.streams) holds the OTHER rows this site resolved for the same
  // episode — the opposite audio flavour and alternate servers/qualities. Swapping loads the
  // sibling in place and resumes at the click-time position; no re-resolve, no picker.
  const recovery = $derived($playbackRecovery)
  const currentStream = $derived(recovery?.current ?? null)
  const variantPool = $derived(recovery?.streams ?? [])
  const altServers = $derived(currentStream ? serverSiblings(currentStream, variantPool) : [])
  // Labelled as a SET: two unnamed mirrors of one site can reduce to the same text, and a menu of
  // identical rows gives no basis to choose.
  const altServerLabels = $derived(variantLabels(altServers))
  let showServers = $state(false)
  let swapping = $state(false)
  async function swapTo(target: Stream) {
    const ctx = get(nowPlayingMedia)
    if (!ctx || swapping) return
    swapping = true
    showServers = false
    const startSeconds = pos // position at CLICK time, not a stale derived
    await playStream(ctx.media, ctx.episode, target, (s) => {
      if (s.status === 'error') playerNotice.set(s.message ?? 'Could not switch source.')
      if (s.status !== 'resolving') swapping = false
    }, { autoplay: true, startSeconds })
    // playStream's ownership guard can return without ever reporting a state; never strand the
    // buttons disabled.
    swapping = false
  }

  // Video fit: 'best' = letterbox (panscan 0); 'fill' = crop-to-fill (panscan 1),
  // aspect preserved either way (never stretched). Persisted + applied live.
  function setFit(f: 'best' | 'fill') { videoFit.set(f); cmd('set', ['panscan', f === 'fill' ? '1.0' : '0.0']) }

  // Screenshot the current frame (with subtitles) → app Pictures/izumi folder.
  async function screenshot() {
    try { await playerScreenshot(); playerNotice.set('Screenshot saved to Pictures/izumi') }
    catch { playerNotice.set('Screenshot failed') }
  }

  async function navigateSubtitleLine(skip: -1 | 0 | 1) {
    const before = parseFloat(await playerGetProperty('time-pos').catch(() => ''))
    try {
      await playerCommand('sub-seek', [String(skip)])
    } catch {
      playerNotice.set('Subtitle navigation is unavailable for this track')
      return
    }

    // mpv can seek anywhere in a fully-loaded external subtitle file. Embedded tracks are
    // demuxed with the video, so a cue beyond the rolling cache is unknowable until it loads.
    // Surface that boundary instead of leaving a click looking broken.
    if (skip !== 0 && Number.isFinite(before)) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const after = parseFloat(await playerGetProperty('time-pos').catch(() => ''))
      if (Number.isFinite(after) && Math.abs(after - before) < 0.05) {
        playerNotice.set(skip > 0
          ? 'No next subtitle line is available in the loaded range'
          : 'No previous subtitle line is available')
      }
    }
  }

  let captureBusy = $state(false)
  function setSleep(value: string) {
    if (value === 'off') playerSleep.set({ deadline: null, atEpisodeEnd: false })
    else if (value === 'end') playerSleep.set({ deadline: null, atEpisodeEnd: true })
    else playerSleep.set({ deadline: Date.now() + Number(value) * 60_000, atEpisodeEnd: false })
    playerNotice.set(value === 'off' ? 'Sleep timer cleared' : value === 'end' ? 'Sleep after this episode' : `Sleep timer set for ${value} minutes`)
  }
  function markLoopA() {
    playerAbLoop.set({ a: pos, b: null })
    cmd('set', ['ab-loop-a', pos.toFixed(3)])
    cmd('set', ['ab-loop-b', 'no'])
    playerNotice.set(`Loop start set at ${fmt(pos)}`)
  }
  function markLoopB() {
    const a = $playerAbLoop.a
    if (a == null || pos <= a + 0.25) {
      playerNotice.set('Set loop A before loop B')
      return
    }
    playerAbLoop.set({ a, b: pos })
    cmd('set', ['ab-loop-b', pos.toFixed(3)])
    playerNotice.set(`Looping ${fmt(a)} – ${fmt(pos)}`)
  }
  function clearLoop() {
    playerAbLoop.set({ a: null, b: null })
    cmd('set', ['ab-loop-a', 'no'])
    cmd('set', ['ab-loop-b', 'no'])
    playerNotice.set('A/B loop cleared')
  }
  async function toggleGifRecording() {
    if ($gifRecordingStart == null) {
      captureBusy = true
      try {
        await playerGifStart($gifIncludeSubtitles)
        gifRecordingStart.set(pos)
        playerNotice.set(`GIF recording started · press ${gm ? 'R4' : 'O'} to stop`)
      } catch {
        playerNotice.set('GIF recording failed to start')
      } finally { captureBusy = false }
      return
    }
    const startedAt = $gifRecordingStart
    gifRecordingStart.set(null)
    captureBusy = true
    playerNotice.set('Encoding GIF…')
    try {
      const background = await playerGifStop({ startSec: startedAt ?? Math.max(0, pos - 3), endSec: pos })
      playerNotice.set(background ? 'Saving GIF in background…' : 'GIF saved to Pictures/izumi')
    } catch (error) {
      playerNotice.set(
        String(error).includes('ffmpeg-unavailable')
          ? 'GIF recording needs ffmpeg installed'
          : String(error).includes('gif-no-frames')
            ? `GIF was too short — hold ${gm ? 'R4' : 'O'} a bit longer`
            : 'GIF recording failed',
      )
    } finally { captureBusy = false }
  }
  async function saveRecentClip() {
    if (pos < 0.5) return
    captureBusy = true
    playerNotice.set('Encoding recent clip…')
    try {
      await invoke('player_capture_segment', { kind: 'clip', startSec: Math.max(0, pos - 30), endSec: pos })
      playerNotice.set('Recent clip saved to Pictures/izumi')
    } catch (error) {
      playerNotice.set(String(error).includes('ffmpeg-unavailable') ? 'Clip capture needs ffmpeg installed' : 'Clip capture failed')
    } finally { captureBusy = false }
  }

  let volume = $state(100)
  let muted = $state(false)
  // Dragging the range fires oninput per integer step (0–130), so pushing the IPC synchronously
  // queued ~130 back-to-back player_command round-trips per drag; mpv only needs the final value.
  // rAF-coalesce to one set/frame (mirrors scrub.ts). Visual state updates synchronously so the
  // slider still tracks the cursor; the trailing oninput always schedules a flush of the last value.
  let volPending = false
  let volLatest = 100
  function flushVolume() {
    volPending = false
    cmd('set', ['volume', String(volLatest)])
    // `toggleMute` used to be the only writer of mpv's `mute`, while the slider inferred `muted`
    // locally — so dragging up from a muted player showed an unmuted speaker at the new volume
    // with the audio still fully silent (and dragging to 0 showed a muted icon on an unmuted core).
    // The slider owns both properties now, so what you see is what mpv is doing.
    cmd('set', ['mute', volLatest === 0 ? 'yes' : 'no'])
  }
  function setVolume(e: Event) {
    volume = Number((e.target as HTMLInputElement).value)
    muted = volume === 0
    volLatest = volume
    if (!volPending) { volPending = true; requestAnimationFrame(flushVolume) }
  }
  function toggleMute() {
    muted = !muted
    cmd('set', ['mute', muted ? 'yes' : 'no'])
  }

  // Controls is conditionally mounted (it unmounts on the 3s auto-hide) but mpv's speed/volume/mute
  // are global and persist across the session — so a fresh mount otherwise showed the $state defaults
  // (1× / 100 / unmuted) while playback ran at the real values, and the next click snapped mpv to the
  // wrong displayed value. Seed local state from mpv on (re)mount. `mute` is a yes/no flag, not a float.
  onMount(() => {
    // Keyboard shortcuts are handled by PlayerOverlay, outside this conditionally-mounted
    // component. Follow mpv's observed property so every mute path updates this icon.
    const unlistenMuted = listen<boolean>('player-muted', (event) => {
      muted = event.payload
    })
    const onQuality = (event: Event) => applyQualityInfo((event as CustomEvent<QualityInfo>).detail)
    window.addEventListener('izumi-drm-quality', onQuality)
    window.addEventListener('player-menu-close', closePlayerMenus)
    const onMenuNav = (event: Event) => {
      if (!gm || !showOptions || get(deckKeyboardWarning)) return
      const dir = (event as CustomEvent<'up' | 'down' | 'left' | 'right'>).detail
      if (dir === 'up') gmMove(-1)
      else if (dir === 'down') gmMove(1)
      else if (dir === 'right') gmActivate()
      else if (dir === 'left') gmBack()
    }
    window.addEventListener('player-menu-nav', onMenuNav)
    const unPad = listenSafe<{ name: string; pressed: boolean }>('gamepad-input', (e) => {
      if (!gm || !showOptions || !e.payload.pressed || get(deckKeyboardWarning)) return
      // Directions are owned by the app-wide repeat translator, which dispatches
      // `player-menu-nav`. Handling the same raw edge here moved two rows per press.
      switch (e.payload.name) {
        case 'a':
          gmActivate(); break
        case 'b': gmBack(); break
      }
    })
    void (async () => {
      try {
        const sp = parseFloat(await invoke<string>('player_get_property', { name: 'speed' }))
        if (!Number.isNaN(sp)) speed = sp
      } catch { /* no player yet — keep default */ }
      try {
        const vol = parseFloat(await invoke<string>('player_get_property', { name: 'volume' }))
        if (!Number.isNaN(vol)) { volume = vol; volLatest = vol }
      } catch { /* no player yet — keep default */ }
      try {
        muted = (await invoke<string>('player_get_property', { name: 'mute' })) === 'yes'
      } catch { /* no player yet — keep default */ }
    })()
    return () => {
      unPad()
      window.removeEventListener('izumi-drm-quality', onQuality)
      window.removeEventListener('player-menu-close', closePlayerMenus)
      window.removeEventListener('player-menu-nav', onMenuNav)
      void unlistenMuted.then((unlisten) => unlisten())
      playerMenuOpen.set(false)
      playerSideSheetOpen.set(false)
    }
  })

  // Track menu (subtitle/audio) — populated lazily from mpv's track-list.
  type Track = {
    id: number; type: string; title?: string; lang?: string; selected?: boolean
    codec?: string; channels?: number; default?: boolean; forced?: boolean
    external?: boolean; externalFilename?: string
  }
  let tracks = $state<Track[]>([])
  let secondaryId = $state('no')
  let showTracks = $state(false)
  // Desktop track menu is a two-level drill-down (root [Audio, Subtitles] → the chosen
  // category's list) with a Miller-column slide. `menuLevel`/`detailCat` drive the slide;
  // `rootH`/`detailH` are the measured column heights so the panel morphs to fit.
  let menuLevel = $state<'root' | 'detail'>('root')
  let detailCat = $state<'audio' | 'subs' | 'captions' | 'secondary' | 'dev' | 'online' | 'style' | 'chapters'>('audio')

  // Subtitle style presets: capture the active ASS track's fonting (mpv sub-ass-extradata) and
  // save it under the release group's name; picking a saved preset overrides styling for THIS
  // session only (PlayerOverlay's style effect prefers `sessionSubtitleStyle`; settings untouched).
  let styleSaveName = $state('')
  let capturedStyle = $state<ReturnType<typeof captureFromExtradata>>(null)
  async function openStyleDetail() {
    openDetail('style')
    capturedStyle = null
    try {
      capturedStyle = captureFromExtradata(await invoke<string>('player_get_property', { name: 'sub-ass-extradata' }))
    }
    catch { capturedStyle = null }
    styleSaveName = subtitlePresetSourceName({
      group: get(bingeSource)?.group,
      title: get(nowPlayingMedia)?.media.title?.userPreferred,
    })
  }
  function saveCapturedStyle() {
    if (!capturedStyle) return
    const preset = saveSubtitlePreset(styleSaveName, capturedStyle, {
      group: get(bingeSource)?.group,
      title: get(nowPlayingMedia)?.media.title?.userPreferred ?? undefined,
    })
    sessionSubtitleStyle.set(preset) // hearing is believing — show the saved look right away
    playerNotice.set(`Saved subtitle style “${preset.name}”`)
  }

  async function saveDeckSubtitleStyle() {
    capturedStyle = captureFromExtradata(
      await invoke<string>('player_get_property', { name: 'sub-ass-extradata' }).catch(() => ''),
    )
    styleSaveName = subtitlePresetSourceName({
      group: get(bingeSource)?.group,
      title: get(nowPlayingMedia)?.media.title?.userPreferred,
    })
    if (!capturedStyle) {
      playerNotice.set('Current subtitle track has no ASS style to save')
      return
    }
    saveCapturedStyle()
    showTracks = false
  }

  // Dev-only tools, reached through the track menu (Subtitles/Audio) as a third "Dev tools"
  // category. import.meta.env.DEV is compiled to a literal false in production, so both the row
  // and this whole block are tree-shaken out of a release build. Copy URL is the first tool;
  // the list is an array so more can be dropped in later.
  const dev = import.meta.env.DEV
  function copyUrl() {
    const url = get(nowPlayingUrl)
    const ok = !!url && copyToClipboard(url)
    playerNotice.set(ok ? 'Video URL copied' : 'No video URL to copy')
  }
  const devTools: { label: string; run: () => void }[] = [{ label: 'Copy URL', run: copyUrl }]
  let rootH = $state(0), detailH = $state(0)
  async function refreshTracks() {
    try {
      const raw = await playerTracks()
      tracks = JSON.parse(raw) as Track[]
      secondaryId = await playerGetProperty('secondary-sid').catch(() => 'no')
    }
    catch (e) {
      console.warn('track-list unavailable', e)
      tracks = []
    }
  }
  async function loadTracks() {
    showOptions = false
    showServers = false
    if (gm) {
      window.dispatchEvent(new Event('gm-open-tracks'))
      return
    }
    showTracks = !showTracks
    menuLevel = 'root'
    if (showTracks) await refreshTracks()
  }
  // A sidecar can finish while this menu is already open. Refresh its live mpv snapshot after
  // every successful sub-add so "Loading subtitles…" turns into selectable tracks in place.
  $effect(() => {
    const revision = $torrentSubtitleState.revision
    if (showTracks && revision > 0) void refreshTracks()
  })
  const subs = $derived(tracks.filter((t) => t.type === 'sub'))
  const captions = $derived(tracks.filter((t) => t.type === 'caption'))
  const audios = $derived(tracks.filter((t) => t.type === 'audio'))

  // Language-forward, deduped track labels — shared with the Game-mode picker so the two
  // never diverge. Leads with the language name (a multi-language Blu-ray's subtitle tracks
  // are only told apart by language, not their identical "Full Subtitles"/codec title). See
  // track-label.ts.
  const label = (track: Track, group: Track[]) =>
    trackLabel(track, group, { filename: $nowPlayingStream.filename })
  function pick(kind: 'sid' | 'aid' | 'secondary-sid' | 'ccid', id: number) {
    cmd('set', [kind, String(id)])
    if (kind === 'secondary-sid') { secondaryId = String(id); return }
    const type = kind === 'sid' ? 'sub' : kind === 'ccid' ? 'caption' : 'audio'
    tracks = tracks.map((t) => {
      if (t.type === type) return { ...t, selected: t.id === id }
      if ((kind === 'sid' || kind === 'ccid') && (t.type === 'sub' || t.type === 'caption')) {
        return { ...t, selected: false }
      }
      return t
    })
    if (kind === 'sid' && $subtitleAutoSync) void autoSyncSelectedSubtitle(tracks, dur, true)
  }

  // Desktop drill-down helpers. `detailItems` is the chosen category's track list;
  // `curLabel` is what shows on the collapsed root row for each category (the active
  // track, or "Off"). `pickLeaf` sets the track then slides back to the root.
  const detailItems = $derived(detailCat === 'audio' ? audios : detailCat === 'captions' ? captions : subs)
  const detailTitle = $derived(detailCat === 'audio' ? 'Audio' : detailCat === 'captions' ? 'Closed captions' : detailCat === 'secondary' ? 'Secondary subtitles' : detailCat === 'dev' ? 'Dev tools' : detailCat === 'online' ? 'Online subtitles' : detailCat === 'style' ? 'Subtitle style' : detailCat === 'chapters' ? 'Chapters' : 'Subtitles')
  // Controls unmounts entirely when the bar is hidden (PlayerOverlay only mounts it while its
  // `controlsVisible` is true), so this only runs while the bar is actually on screen — one lookup
  // shared by the track-menu highlight below and the overlay label further down.
  const chapterIdx = $derived(activeChapterIndex($chapterStore, pos))
  // The menu highlight only needs to mean anything while the chapters detail pane is open — showing
  // a "current" row for a closed menu would be pointless, so this stays -1 otherwise.
  const activeChapter = $derived(showTracks && detailCat === 'chapters' ? chapterIdx : -1)
  // Generic titles ("Chapter 1", a bare number — see isGenericChapterTitle) are suppressed rather
  // than shown: they cost screen space and tell the user nothing the seekbar doesn't already.
  const activeChapterTitle = $derived.by(() => {
    const c = $chapterStore[chapterIdx]
    if (!c || isGenericChapterTitle(c.title ?? '')) return ''
    return c.title.trim()
  })
  const leafKind = $derived<'aid' | 'sid' | 'secondary-sid' | 'ccid'>(
    detailCat === 'audio' ? 'aid' : detailCat === 'secondary' ? 'secondary-sid' : detailCat === 'captions' ? 'ccid' : 'sid',
  )
  const detailOff = $derived(detailCat === 'secondary' ? secondaryId === 'no' : !detailItems.some((t) => t.selected)) // nothing selected ⇒ "Off" is active
  const curLabel = (group: Track[]) => {
    const on = group.find((t) => t.selected)
    return on ? label(on, group) : 'Off'
  }
  const curAudioLabel = $derived(curLabel(audios))
  const curSubLabel = $derived(
    !subs.length && $torrentSubtitleState.status === 'loading'
      ? 'Loading…'
      : curLabel(subs),
  )
  const curCaptionLabel = $derived(curLabel(captions))
  const curSecondaryLabel = $derived.by(() => {
    const track = subs.find((item) => String(item.id) === secondaryId)
    return track ? label(track, subs) : 'Off'
  })
  function openDetail(cat: 'audio' | 'subs' | 'captions' | 'secondary' | 'dev' | 'online' | 'style' | 'chapters') {
    detailCat = cat
    menuLevel = 'detail'
  }
  // Disable the category (mpv uses aid/sid = "no"; 0 isn't a valid track id).
  function pickOff() {
    if (detailCat === 'secondary') { cmd('set', ['secondary-sid', 'no']); secondaryId = 'no'; return }
    const type = detailCat === 'audio' ? 'audio' : detailCat === 'captions' ? 'caption' : 'sub'
    cmd('set', [leafKind, 'no'])
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: false } : t))
  }

  // Online subtitles (OpenSubtitles / SubDL): candidates are searched on play and stashed in
  // `onlineSubCandidates`; picking a row hands the byte work to Rust, which downloads + normalizes
  // + live `sub-add`s it, after which we re-read the track-list so the new sub shows selected.
  let subQuery = $state('')
  let downloadingKey = $state<string | null>(null)
  // Titles of the currently-selected sub tracks — a candidate shows its Check when a selected
  // track carries the exact title we passed to `sub-add`.
  const loadedSubTitles = $derived(subs.filter((s) => s.selected).map((s) => s.title ?? ''))
  function reSearchOnline() { void searchOnlineSubtitles() }
  function onSubQueryKey(e: KeyboardEvent) { if (e.key === 'Enter') { e.preventDefault(); reSearchOnline() } }
  // The manual box filters the already-fetched candidates client-side (release/lang substring); the
  // refresh button / Enter re-fetches from the providers (id-based) for the current episode.
  const filteredCandidates = $derived(
    subQuery.trim()
      ? $onlineSubCandidates.items.filter((c) => `${c.lang ?? ''} ${c.release ?? ''}`.toLowerCase().includes(subQuery.trim().toLowerCase()))
      : $onlineSubCandidates.items,
  )
  async function addOnlineSub(c: SubtitleCandidate) {
    downloadingKey = candidateKey(c)
    try {
      await invoke('player_add_subtitle', {
        provider: c.provider,
        url: candidateDownloadUrl(c),
        fileId: c.download?.fileId,
        lang: c.lang ?? 'und',
        title: candidateTitle(c),
        apiKey: candidateApiKey(c.provider),
        token: get(openSubtitlesToken),
      })
      tracks = JSON.parse(await playerTracks()) as Track[]
      subtitleNotice.set('')
      if ($subtitleAutoSync) void autoSyncSelectedSubtitle(tracks, dur, true)
    }
    catch (e) {
      console.warn('add online subtitle failed', e)
      subtitleNotice.set(subtitleErrorNotice(c.provider, e))
    }
    finally { downloadingKey = null }
  }

  // Keep Controls mounted (and the overlay full-viewport) while a popover is open. Reset on
  // unmount so the flag cannot stick true after the player closes.
  $effect(() => {
    playerMenuOpen.set(showOptions || showTracks || showServers)
    playerSideSheetOpen.set(native && (showOptions || showTracks || showServers))
  })
</script>

<!-- Now-playing title, reused above the seek bar (default) or at the top (Game-mode option). -->
{#snippet titleBlock(big: boolean)}
  {#if np.animeTitle}
    <div class="min-w-0 pt-0.5 [text-shadow:0_1px_4px_rgba(0,0,0,.7)]">
      <div data-gm-title class="line-clamp-1 text-white {big ? 'text-3xl font-black leading-tight drop-shadow' : 'text-lg font-semibold'}">{np.animeTitle}</div>
      {#if np.episode != null}
        <div data-gm-episode class="line-clamp-1 {big ? 'text-lg font-semibold leading-snug text-white/75' : 'text-sm font-normal text-white/60'}">Episode {np.episode}{np.total ? ` / ${np.total}` : ''}</div>
      {/if}
    </div>
  {/if}
{/snippet}

<!-- stopPropagation: control clicks must not bubble to the video click-to-pause. -->
<div data-gm-control-root class="pointer-events-none absolute inset-0" onclick={(e) => e.stopPropagation()} role="presentation">
  <!-- Top bar: Back button (Desktop only — Game mode uses the B button to leave, so no
       redundant on-screen Back) and, when the Game-mode "title at top" option is on, the
       title. Rendered only when it has something to show. -->
  {#if !gm || titleTop}
    <!-- Windowed playback keeps the custom titlebar (a fixed top-0 z-50 `data-tauri-drag-region`
         strip, 32px tall) ABOVE this z-20 overlay — its transparent drag region covered the top of
         the Back button, so a click on the (vertically-centred) label hit the window-drag region,
         not the button. Push the bar below the titlebar when windowed so the whole button clears it.
         Fullscreen / Game mode hide the titlebar, so no offset there. -->
    <!-- Same reasoning as the bottom bar: this strip spans the full width for the sake of one Back
         button, so leaving it pointer-events-auto made the entire top of the video a click-to-pause
         dead zone. The button opts back in; the gradient and title fall through. -->
    <div class="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/70 to-transparent {gm ? 'px-8 py-6' : $fullscreen ? 'px-4 py-3' : 'px-4 pb-3 pt-11'}">
      {#if !gm}
        <button data-focusable onclick={onclose} aria-label="Back"
                class="pointer-events-auto flex shrink-0 select-none items-center gap-1.5 rounded-full bg-black/60 py-2 pl-2.5 pr-3.5 text-sm font-bold text-white transition hover:bg-black/80">
          <ArrowLeft size={icSize} /><span>Back</span>
        </button>
      {/if}
      {#if titleTop}<div class="min-w-0 flex-1">{@render titleBlock(true)}</div>{/if}
    </div>
  {/if}

  <!-- Bottom control bar: a gradient that floats over the video. Works identically on Desktop
       (subsurface below the webview) and Game mode (gamescope layer-shell surface below the
       webview) — the compositor blends the transparent webview over the video either way. -->
  <!-- The CONTAINER is pointer-events-none on purpose. It is `inset-x-0 bottom-0` with `pt-20`, so
       it reaches ~80px above the seek bar plus the side gutters and the title — and while it was
       pointer-events-auto, every click in that band was swallowed by the root's stopPropagation
       and did nothing at all. Click-to-pause only worked once you got clear of the whole gradient.
       Only the rows that actually ARE controls opt back in below; the gradient, the padding and the
       title now fall through to the overlay's click-to-pause. The Seekbar keeps its own `py-3` grab
       padding, so there is still a forgiving band that seeks rather than pausing. -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 {gm ? 'bg-gradient-to-t from-black/80 via-black/40 to-transparent px-8 pb-6 pt-14' : 'bg-gradient-to-t from-black/85 via-black/45 to-transparent px-6 pb-5 pt-20'}">
    <!-- Now-playing title above the seek bar (unless it's been moved to the top). Scales up
         in Game mode to match the enlarged controls. -->
    {#if !titleTop}
      <div class="mb-2">{@render titleBlock(gm)}</div>
    {/if}

    <!-- Game mode: flank the bar with current + total time (Crunchy-Deck style) so the bar itself
         is narrower; Desktop keeps the full-width bar with the time in the button row. -->
    {#if gm}
      <div class="pointer-events-auto flex items-center gap-3">
        <!-- XWayland's visible time/bar pixels come from mpv's live OSD, so these HTML elements
             become transparent measurement/hit targets there. Native Wayland paints them live. -->
        <span class="w-16 shrink-0 select-none text-right font-mono text-base tabular-nums" class:opacity-0={native}>{fmt(pos)}</span>
        <div class="min-w-0 flex-1"><Seekbar {pos} {dur} {buffer} {segments} chapters={$chapterStore} {gm} {native} onseek={seekTo} {onscrubinput} /></div>
        <span class="w-16 shrink-0 select-none font-mono text-base tabular-nums" class:opacity-0={native}>{fmt(dur)}</span>
      </div>
    {:else}
      <div class="pointer-events-auto"><Seekbar {pos} {dur} {buffer} {segments} chapters={$chapterStore} {gm} {native} onseek={seekTo} {onscrubinput} /></div>
    {/if}

    <div class="pointer-events-auto mt-1 flex items-center gap-3 text-white {gm ? 'gap-4' : ''}">
      {#if hasPrev}
        <button data-focusable class={iconBtn} onclick={() => (gm ? episodeStep(-1) : playPrev(undefined, !paused))} aria-label="Previous episode"><SkipBack size={icSize} fill="currentColor" /></button>
      {/if}
      <!-- Play/pause: Game mode gets a filled white circle (no outline) — the primary,
           thumb-sized touch target; Desktop keeps the subtle hover-only button. -->
      <button data-focusable onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}
              class="grid place-items-center rounded-full focus-ring-inset {gm ? 'gm-play size-16 bg-white text-black shadow-lg' : 'size-10 transition hover:bg-white/15'}">
        {#if paused}<Play size={gm ? 30 : 22} fill="currentColor" />{:else}<Pause size={gm ? 30 : 22} fill="currentColor" />{/if}
      </button>
      {#if hasNext}
        <!-- A dot when the next episode is already resolved and will start instantly. Shown only
             when true: under the noAdd contract most episodes are NOT preloaded, so a persistent
             "not ready" state would be noise rather than information. -->
        <button
          data-focusable
          class="{iconBtn} relative"
          onclick={() => (gm ? episodeStep(1) : playNext(undefined, !paused))}
          aria-label={nextReady ? 'Next episode (ready to play)' : 'Next episode'}
          title={nextReady ? 'Next episode is ready — starts instantly' : undefined}
        >
          <SkipForward size={icSize} fill="currentColor" />
          {#if nextReady}
            <span class="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"></span>
          {/if}
        </button>
      {/if}

      <!-- Desktop shows the time here; Game mode moved it to flank the bar (above). The active
           chapter title rides along, Desktop-only — Game mode's bar is already tight on a Deck,
           and confining the experiment to one surface keeps a revert clean either way. -->
      {#if !gm}
        <span class="ml-1 select-none font-mono tabular-nums text-sm">{fmt(pos)} / {fmt(dur)}</span>
        {#if activeChapterTitle}
          <span class="hidden min-w-0 max-w-[16rem] truncate text-xs text-white/50 sm:inline">{activeChapterTitle}</span>
        {/if}
      {/if}

      <div class="ml-auto flex items-center gap-3 {gm ? 'gap-4' : ''}">
        <!-- Volume — Desktop only; Game mode uses the Deck's hardware volume. -->
        {#if !gm}
        <div class="group/vol flex items-center gap-1">
          <button data-focusable class={iconBtn} onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {#if muted}<VolumeX size={icSize} />{:else}<Volume2 size={icSize} />{/if}
          </button>
          <input
            data-focusable
            type="range"
            class="h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100"
            min="0" max="130" step="1" value={muted ? 0 : volume}
            oninput={setVolume}
            aria-label="Volume"
          />
        </div>
        {/if}

        <!-- Playback options: speed, audio/subtitle delay, subtitle size. In Game mode it sits to
             the RIGHT of the Subtitles button (Crunchy-Deck order) via order-last. -->
        <div class="relative {gm ? 'order-last' : ''}">
          <button data-focusable class={iconBtn} onclick={toggleOptions} aria-label="Playback options"><Settings size={icSize} /></button>
          {#if showOptions && !gm}
            <div class="absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-neutral-900 p-3 text-sm text-white shadow-xl [transform:translateZ(0)] [will-change:transform]">
              <button data-focusable onclick={changeSource} class="mb-3 w-full rounded bg-white/10 px-2.5 py-2 text-left text-sm font-bold transition hover:bg-white/20">Change source…</button>
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Speed</p>
              <!-- Fixed 6-col grid so all speeds sit on ONE even row (flex-wrap dropped "2×"
                   onto a lonely second line). -->
              <div class="mb-3 grid grid-cols-6 gap-1">
                {#each speeds as s}
                  <button data-focusable onclick={() => setSpeed(s)} class="rounded py-1 text-center text-xs tabular-nums transition {speed === s ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{s}×</button>
                {/each}
              </div>
              {#if qualityInfo.heights.length}
                <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Quality</p>
                <div class="mb-3 flex flex-wrap gap-1">
                  <button
                    data-focusable
                    aria-label="Video quality Auto"
                    onclick={() => setVideoQuality('auto')}
                    class="rounded px-2 py-1 text-xs transition {qualityInfo.mode === 'auto' ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/15'}"
                  >Auto{#if qualityInfo.mode === 'auto' && qualityInfo.activeHeight} · {qualityInfo.activeHeight}p{/if}</button>
                  {#each qualityInfo.heights as height}
                    <button
                      data-focusable
                      aria-label="Video quality {height}p"
                      onclick={() => setVideoQuality(height)}
                      class="rounded px-2 py-1 text-xs transition {qualityInfo.mode === height ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/15'}"
                    >{height}p</button>
                  {/each}
                </div>
              {/if}
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Video fit</p>
              <div class="mb-3 flex gap-1">
                {#each [['best', 'Best fit'], ['fill', 'Fill']] as [v, l]}
                  <button data-focusable onclick={() => setFit(v as 'best' | 'fill')} class="flex-1 rounded px-2 py-1 text-xs transition {$videoFit === v ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{l}</button>
                {/each}
              </div>
              <button data-focusable onclick={openSubtitleEditor} class="mb-3 w-full rounded bg-white/10 px-2.5 py-2 text-left text-sm font-bold transition hover:bg-white/20">Edit subtitle position &amp; size…</button>
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Tools</p>
              <div class="mb-3 grid grid-cols-2 gap-1">
                <button data-focusable onclick={() => playerStatsOpen.update((value) => !value)} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">{$playerStatsOpen ? 'Hide stats' : 'Show stats'}</button>
                <select data-focusable aria-label="Sleep timer" onchange={(event) => setSleep((event.currentTarget as HTMLSelectElement).value)} class="rounded bg-white/10 px-2 py-1.5 text-xs">
                  <option value="off">Sleep: off</option>
                  <option value="15">Sleep: 15 min</option>
                  <option value="30">Sleep: 30 min</option>
                  <option value="45">Sleep: 45 min</option>
                  <option value="end">Sleep: episode end</option>
                </select>
                <button data-focusable onclick={markLoopA} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">Set loop A{#if $playerAbLoop.a != null} ✓{/if}</button>
                <button data-focusable onclick={markLoopB} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">Set loop B{#if $playerAbLoop.b != null} ✓{/if}</button>
                {#if $playerAbLoop.a != null}<button data-focusable onclick={clearLoop} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20">Clear loop</button>{/if}
                <button data-focusable disabled={captureBusy} onclick={toggleGifRecording} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40">{$gifRecordingStart == null ? 'Record GIF' : 'Stop GIF'}</button>
                {#if !$nowPlayingStream.drm}
                  <button data-focusable disabled={captureBusy} onclick={saveRecentClip} class="rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40">Save last 30s</button>
                {/if}
              </div>
              {#each ($nowPlayingStream.drm ? [['Subtitle size', 'sub-scale']] : [['Subtitle delay', 'sub-delay'], ['Audio delay', 'audio-delay'], ['Subtitle size', 'sub-scale']]) as [label, prop]}
                <div class="flex items-center justify-between gap-2 py-0.5">
                  <span>{label}</span>
                  <span class="flex items-center gap-1">
                    <button data-focusable onclick={() => adjust(prop, -0.1)} class="grid size-6 place-items-center rounded bg-white/10 hover:bg-white/20" aria-label="Decrease {label}">−</button>
                    <button data-focusable onclick={() => resetProp(prop)} title="Reset {label}" class="w-12 text-center text-xs tabular-nums text-white/70 transition-colors hover:text-white" aria-label="Reset {label}">{fmtDelay(prop, delays[prop] ?? 0)}</button>
                    <button data-focusable onclick={() => adjust(prop, 0.1)} class="grid size-6 place-items-center rounded bg-white/10 hover:bg-white/20" aria-label="Increase {label}">+</button>
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Discussion / comments panel toggle (keyed on the playing episode). -->
        <button data-focusable class={iconBtn} onclick={toggleComments}
                aria-label="Discussion" aria-pressed={$commentsOpen}>
          <MessageSquare size={icSize} class={$commentsOpen ? 'text-theme' : ''} />
        </button>

        <!-- Alternate servers/qualities for the current source (same site, same flavour). -->
        {#if altServers.length}
          <div class="relative">
            <button data-focusable class={iconBtn} onclick={() => { showServers = !showServers; showOptions = false; showTracks = false }} aria-label="Switch server"><ArrowRightLeft size={icSize} /></button>
            {#if showServers}
              <!-- Same popover rules as the options menu: no backdrop-blur; Desktop promotes its
                   own layer, Game mode must stay on the base layer to snapshot crisply. -->
              <div data-gm-side-sheet={gm ? '' : undefined} class="{gm
                ? 'gm-sheet gm-sheet-in fixed right-5 top-[18%] z-30 w-[22rem] max-h-[70vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#1a1a1a] p-3 text-sm text-white shadow-2xl'
                : 'absolute bottom-full right-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-lg bg-neutral-900 p-2 text-sm text-white shadow-xl [transform:translateZ(0)] [will-change:transform]'}">
                <p class="px-2 py-1 text-xs uppercase tracking-wide text-white/50">Servers</p>
                {#each altServers as alt, i (alt.url)}
                  <button data-focusable disabled={swapping} class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15 disabled:opacity-40" onclick={() => swapTo(alt)}>
                    {altServerLabels[i]}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Subtitle / audio track menu -->
        <div class="relative">
          <button data-focusable class={iconBtn} onclick={loadTracks} aria-label="Subtitle and audio tracks"><Languages size={icSize} /></button>
          {#if showTracks}
            {#if gm}
              <!-- Game mode keeps the flat, tap-friendly list (the ☰ TrackMenu is the primary
                   Deck path; this popover is the fallback and stays snapshot-crisp with no promoted layer). -->
              <div data-gm-side-sheet class="gm-sheet gm-sheet-in fixed right-5 top-[14%] z-30 max-h-[72vh] w-[22rem] overflow-y-auto rounded-3xl border border-white/10 bg-[#1a1a1a] p-3 text-sm text-white shadow-2xl">
                <p class="px-2 py-1 text-xs uppercase tracking-wide text-white/50">Audio</p>
                {#if audios.length}
                  {#each audios as t (t.id)}
                    <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('aid', t.id)}>
                      {t.selected ? '✓ ' : ''}{label(t, audios)}
                    </button>
                  {/each}
                {:else}
                  <p class="px-2 py-1 text-white/40">No audio tracks</p>
                {/if}

                <p class="mt-1 px-2 py-1 text-xs uppercase tracking-wide text-white/50">Subtitles</p>
                <!-- mpv disables subs with sid=no (0 is not a valid track id). -->
                <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => { cmd('set', ['sid', 'no']); tracks = tracks.map((t) => (t.type === 'sub' ? { ...t, selected: false } : t)) }}>None</button>
                {#each subs as t (t.id)}
                  <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('sid', t.id)}>
                    {t.selected ? '✓ ' : ''}{label(t, subs)}
                  </button>
                {/each}
                {#if captions.length}
                  <p class="mt-1 px-2 py-1 text-xs uppercase tracking-wide text-white/50">Closed captions</p>
                  <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => { cmd('set', ['ccid', 'no']); tracks = tracks.map((t) => (t.type === 'caption' ? { ...t, selected: false } : t)) }}>None</button>
                  {#each captions as t (t.id)}
                    <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('ccid', t.id)}>
                      {t.selected ? '✓ ' : ''}{label(t, captions)}
                    </button>
                  {/each}
                {/if}
                <p class="mt-1 px-2 py-1 text-xs uppercase tracking-wide text-white/50">Subtitle style</p>
                <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15"
                        onclick={() => { sessionSubtitleStyle.set(null); playerNotice.set('Using default subtitle style'); showTracks = false }}>
                  Use default style
                </button>
                {#each $savedSubtitleStyles as preset (preset.id)}
                  <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15"
                          onclick={() => { sessionSubtitleStyle.set(preset); playerNotice.set(`Applied subtitle style: ${preset.name}`); showTracks = false }}>
                    Apply {preset.name}
                  </button>
                {/each}
                <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={saveDeckSubtitleStyle}>
                  Save current release style
                </button>
              </div>
            {:else}
              <!-- Desktop: a two-level drill-down. Root shows the two categories with their
                   active track; picking one slides (Miller-column) into just that category's
                   list — not one flat wall. The port height morphs between the two columns'
                   measured heights so the panel resizes with the slide. -->
              <div class="absolute bottom-full right-0 mb-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-sm text-white shadow-2xl [transform:translateZ(0)] [will-change:transform]">
                <div class="overflow-hidden transition-[height] duration-200 ease-out" style="height:{menuLevel === 'root' ? rootH : detailH}px">
                  <div class="flex w-[200%] [transition:transform_200ms_cubic-bezier(.25,1,.5,1)]" style="transform:translateX({menuLevel === 'root' ? '0' : '-50%'})">
                    <!-- ROOT: the two categories -->
                    <div class="w-1/2 p-2" bind:clientHeight={rootH}>
                      <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('audio')}>
                        <span class="min-w-0">
                          <span class="block text-xs uppercase tracking-wide text-white/45">Audio</span>
                          <span class="block truncate">{curAudioLabel}</span>
                        </span>
                        <ChevronRight size={18} class="shrink-0 text-white/40" />
                      </button>
                      <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('subs')}>
                        <span class="min-w-0">
                          <span class="block text-xs uppercase tracking-wide text-white/45">Subtitles</span>
                          <span class="block truncate">{curSubLabel}</span>
                        </span>
                        <ChevronRight size={18} class="shrink-0 text-white/40" />
                      </button>
                      {#if captions.length}
                        <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('captions')}>
                          <span class="min-w-0">
                            <span class="block text-xs uppercase tracking-wide text-white/45">Closed captions</span>
                            <span class="block truncate">{curCaptionLabel}</span>
                          </span>
                          <ChevronRight size={18} class="shrink-0 text-white/40" />
                        </button>
                      {/if}
                      <!-- Hidden entirely (not just empty) when the file has no chapters: most anime
                           web releases ship none, and an empty category is worse than no category. -->
                      {#if $chapterStore.length}
                        <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('chapters')}>
                          <span class="min-w-0">
                            <span class="block text-xs uppercase tracking-wide text-white/45">Chapters</span>
                            <span class="block truncate">{$chapterStore.length} chapters</span>
                          </span>
                          <ChevronRight size={18} class="shrink-0 text-white/40" />
                        </button>
                      {/if}
                      {#if $secondarySubtitles}
                        <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('secondary')}>
                          <span class="min-w-0">
                            <span class="block text-xs uppercase tracking-wide text-white/45">Secondary subtitles</span>
                            <span class="block truncate">{curSecondaryLabel}</span>
                          </span>
                          <ChevronRight size={18} class="shrink-0 text-white/40" />
                        </button>
                      {/if}
                      <!-- Online subtitles (OpenSubtitles / SubDL): searched on play, picked here. -->
                      <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('online')}>
                        <span class="flex min-w-0 items-center gap-2">
                          <Languages size={15} class="shrink-0 text-white/45" />
                          <span class="block truncate text-white/80">Online subtitles</span>
                        </span>
                        <ChevronRight size={18} class="shrink-0 text-white/40" />
                      </button>
                      <!-- Saved fonting presets: capture this release's look / override this session. -->
                      <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={openStyleDetail}>
                        <span class="flex min-w-0 items-center gap-2">
                          <Brush size={15} class="shrink-0 text-white/45" />
                          <span class="block truncate text-white/80">Subtitle style</span>
                        </span>
                        <span class="flex min-w-0 items-center gap-1">
                          <span class="max-w-24 truncate text-xs text-white/45">{$sessionSubtitleStyle?.name ?? 'Default'}</span>
                          <ChevronRight size={18} class="shrink-0 text-white/40" />
                        </span>
                      </button>
                      {#if dev}
                        <!-- Dev-only (tree-shaken from release): tools like Copy URL. -->
                        <button data-focusable class="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border-t border-white/10 px-3 py-2.5 text-left transition hover:bg-white/10" onclick={() => openDetail('dev')}>
                          <span class="flex min-w-0 items-center gap-2">
                            <Wrench size={15} class="shrink-0 text-white/45" />
                            <span class="block truncate text-white/80">Dev tools</span>
                          </span>
                          <ChevronRight size={18} class="shrink-0 text-white/40" />
                        </button>
                      {/if}
                    </div>
                    <!-- DETAIL: the chosen category's list -->
                    <div class="w-1/2 p-2" bind:clientHeight={detailH}>
                      <div class="mb-1 flex items-center gap-1">
                        <button data-focusable class="flex flex-1 items-center gap-1 rounded-lg px-2 py-1.5 text-left font-semibold transition hover:bg-white/10" onclick={() => (menuLevel = 'root')}>
                          <ChevronLeft size={18} class="shrink-0 text-white/60" />
                          {detailTitle}
                        </button>
                        {#if detailCat === 'online'}
                          <button data-focusable onclick={reSearchOnline} aria-label="Search again"
                                  class="grid size-8 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/10">
                            <RefreshCw size={16} class={$onlineSubCandidates.status === 'searching' ? 'animate-spin' : ''} />
                          </button>
                        {/if}
                      </div>
                      {#if detailCat === 'chapters'}
                        <div class="max-h-64 overflow-y-auto">
                          <!-- Keyed on index, not `c.time`: activeChapterIndex's own doc notes a
                               zero-length chapter can share a timestamp with its neighbour, and the
                               store is always replaced wholesale (never spliced), so index is stable. -->
                          {#each $chapterStore as c, i (i)}
                            <button data-focusable onclick={() => { seekTo(c.time); showTracks = false }}
                                    class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10">
                              <span class="min-w-0">
                                <span class="block truncate">{c.title?.trim() || 'Chapter'}</span>
                                <span class="block text-xs tabular-nums text-white/45">{formatChapterTime(c.time)}</span>
                              </span>
                              {#if i === activeChapter}<Check size={18} class="shrink-0 text-primary" />{/if}
                            </button>
                          {/each}
                        </div>
                      {:else if detailCat === 'online'}
                        <label class="mb-2 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5">
                          <Search size={15} class="shrink-0 text-white/50" />
                          <input data-focusable bind:value={subQuery} onkeydown={onSubQueryKey} placeholder="Search subtitles…" class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                        </label>
                        {#if $subtitleNotice}
                          <p class="mb-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/55">{$subtitleNotice}</p>
                        {/if}
                        <div class="max-h-56 overflow-y-auto">
                          {#if $onlineSubCandidates.status === 'searching'}
                            <div class="flex items-center gap-2 px-3 py-2 text-white/60">
                              <span class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
                              Searching…
                            </div>
                          {:else if filteredCandidates.length}
                            {#each filteredCandidates as c (candidateKey(c))}
                              <button data-focusable disabled={downloadingKey === candidateKey(c)} onclick={() => addOnlineSub(c)}
                                      class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10 disabled:opacity-50">
                                <span class="min-w-0">
                                  <span class="flex items-center gap-1.5">
                                    <span class="truncate font-bold">{c.lang ?? 'und'}</span>
                                    <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{providerBadge(c.provider)}</span>
                                  </span>
                                  {#if c.release}<span class="block truncate text-xs text-white/45">{c.release}</span>{/if}
                                </span>
                                {#if downloadingKey === candidateKey(c)}
                                  <span class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
                                {:else if isCandidateLoaded(c, loadedSubTitles)}
                                  <Check size={18} class="shrink-0 text-primary" />
                                {/if}
                              </button>
                            {/each}
                          {:else}
                            <p class="px-3 py-2 text-white/40">No online subtitles found</p>
                          {/if}
                        </div>
                      {:else if detailCat === 'style'}
                        <div class="max-h-64 overflow-y-auto">
                          {#if capturedStyle}
                            <!-- Capture row: name (prefilled with the release group) + save. -->
                            <label class="mb-1 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5">
                              <input data-focusable bind:value={styleSaveName} placeholder="Preset name" class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                            </label>
                            <button data-focusable class="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-primary transition hover:bg-white/10" onclick={saveCapturedStyle}>
                              <span class="truncate">Save this release’s fonting ({capturedStyle.font})</span>
                            </button>
                          {:else}
                            <p class="px-3 py-2 text-xs text-white/45">The current subtitle track has no readable ASS styling to capture.</p>
                          {/if}
                          <!-- Session override picker: "Your settings" = no override. -->
                          <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={() => sessionSubtitleStyle.set(null)}>
                            <span class="truncate text-white/70">Your settings</span>
                            {#if !$sessionSubtitleStyle}<Check size={18} class="shrink-0 text-primary" />{/if}
                          </button>
                          {#each $savedSubtitleStyles as p (p.id)}
                            <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={() => sessionSubtitleStyle.set(p)}>
                              <span class="min-w-0">
                                <span class="block truncate">{p.name}</span>
                                <span class="block truncate text-xs text-white/45">{p.style.font}</span>
                              </span>
                              {#if $sessionSubtitleStyle?.id === p.id}<Check size={18} class="shrink-0 text-primary" />{/if}
                            </button>
                          {/each}
                        </div>
                      {:else}
                        <div class="max-h-64 overflow-y-auto">
                          {#if detailCat === 'dev'}
                            {#each devTools as tool (tool.label)}
                              <button data-focusable class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={tool.run}>
                                <span class="truncate">{tool.label}</span>
                              </button>
                            {/each}
                          {:else}
                            <!-- Subs/CC can be disabled. Audio cannot — turning the soundtrack
                                 "off" would keep playing it with no way to get it back. -->
                            {#if detailCat !== 'audio'}
                              <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={pickOff}>
                                <span class="truncate text-white/70">Off</span>
                                {#if detailOff}<Check size={18} class="shrink-0 text-primary" />{/if}
                              </button>
                            {/if}
                            {#if detailItems.length}
                              {#each detailItems as t (t.id)}
                                <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={() => pick(leafKind, t.id)}>
                                  <span class="truncate">{label(t, detailItems)}</span>
                                  {#if detailCat === 'secondary' ? String(t.id) === secondaryId : t.selected}<Check size={18} class="shrink-0 text-primary" />{/if}
                                </button>
                              {/each}
                            {/if}
                            {#if detailCat === 'subs' && $torrentSubtitleState.status === 'loading'}
                              <div class="flex items-center gap-2 px-3 py-2 text-white/55">
                                <span class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
                                <span>Loading subtitles…</span>
                              </div>
                            {:else if detailCat === 'subs' && $torrentSubtitleState.status === 'error' && !detailItems.length}
                              <p class="px-3 py-2 text-white/40">Bundled subtitles failed to load</p>
                            {:else if !detailItems.length}
                              <p class="px-3 py-2 text-white/40">No {detailTitle.toLowerCase()} tracks</p>
                            {/if}
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          {/if}
        </div>

        {#if $subtitleLineNavigation}
          <div class="hidden items-center gap-1 sm:flex" aria-label="Subtitle line navigation">
            <button data-focusable class={iconBtn} onclick={() => navigateSubtitleLine(-1)} aria-label="Previous subtitle line" title="Previous subtitle line">
              <span class="relative grid place-items-center">
                <Captions size={icSize} />
                <ChevronLeft size={11} strokeWidth={3} class="absolute -bottom-1 -left-1 rounded-full bg-black/80" />
              </span>
            </button>
            <button data-focusable class={iconBtn} onclick={() => navigateSubtitleLine(0)} aria-label="Replay subtitle line" title="Replay subtitle line">
              <span class="relative grid place-items-center">
                <Captions size={icSize} />
                <RefreshCw size={10} strokeWidth={3} class="absolute -bottom-1 -right-1 rounded-full bg-black/80" />
              </span>
            </button>
            <button data-focusable class={iconBtn} onclick={() => navigateSubtitleLine(1)} aria-label="Next subtitle line" title="Next subtitle line">
              <span class="relative grid place-items-center">
                <Captions size={icSize} />
                <ChevronRight size={11} strokeWidth={3} class="absolute -bottom-1 -right-1 rounded-full bg-black/80" />
              </span>
            </button>
          </div>
        {/if}

        <!-- Screenshot the current frame → Pictures/izumi. Game mode keeps this off the visual
             bar because Izumi maps its own screenshot action to L4 (R4 is Izumi's GIF recorder). -->
        {#if !gm}
          <button data-focusable class={iconBtn} onclick={screenshot} aria-label="Screenshot"><Camera size={icSize} /></button>
          <button data-focusable class={iconBtn} onclick={togglePictureInPicture} aria-label="Picture in picture"><PictureInPicture size={icSize} /></button>
        {/if}

        <!-- Fullscreen (user-initiated; player opens windowed). Hidden in game mode —
             the Deck player is always fullscreen, there is no windowed state. -->
        {#if !gm}
          <button data-focusable class={iconBtn} onclick={toggleFullscreen} aria-label="Toggle fullscreen">
            {#if $fullscreen}<Minimize size={icSize} />{:else}<Maximize size={icSize} />{/if}
          </button>
        {/if}
      </div>
    </div>
  </div>

  {#if gm && showOptions}
    <div class="gm-sheet-backdrop pointer-events-auto fixed inset-0 z-40 bg-black/50" onclick={closePlayerMenus} role="presentation">
    <div data-gm-side-sheet class="gm-sheet gm-sheet-in absolute top-10 bottom-10 right-8 z-40 flex w-[22rem] flex-col overflow-y-auto rounded-3xl border border-white/10 bg-[#1a1a1a] p-3 text-white shadow-2xl" onclick={(e) => e.stopPropagation()} role="presentation">
      {#if gmSettingsPage === 'root'}
        <p class="px-3 py-2 text-2xl font-bold">Settings</p>
        <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 0} class:text-black={gmSetIdx === 0} onclick={changeSource}><span>Change source</span><span class="opacity-50">›</span></button>
        <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 1} class:text-black={gmSetIdx === 1} onclick={() => gmOpenPage('speed')}><span>Speed</span><span class="opacity-50">{speed}× ›</span></button>
        {#if qualityInfo.heights.length}
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 2} class:text-black={gmSetIdx === 2} onclick={() => gmOpenPage('quality')}>
            <span>Quality</span>
            <span class="opacity-50">{qualityInfo.mode === 'auto' ? `Auto${qualityInfo.activeHeight ? ` (${qualityInfo.activeHeight}p)` : ''}` : `${qualityInfo.mode}p`} ›</span>
          </button>
        {/if}
        <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === gmRootKeys.indexOf('fit')} class:text-black={gmSetIdx === gmRootKeys.indexOf('fit')} onclick={() => gmOpenPage('fit')}><span>Video fit</span><span class="opacity-50">{$videoFit === 'fill' ? 'Fill' : 'Best fit'} ›</span></button>
        <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === gmRootKeys.indexOf('subtitles')} class:text-black={gmSetIdx === gmRootKeys.indexOf('subtitles')} onclick={openSubtitleEditor}><span>Edit subtitles</span><span class="opacity-50">Position &amp; size ›</span></button>
        <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === gmRootKeys.indexOf('tools')} class:text-black={gmSetIdx === gmRootKeys.indexOf('tools')} onclick={() => gmOpenPage('tools')}><span>Tools</span><span class="opacity-50">›</span></button>
      {:else}
        <button data-focusable class="gm-set-row mb-1 font-bold" class:bg-white={gmSetIdx === 0} class:text-black={gmSetIdx === 0} onclick={gmBack}>
          <span>‹ {gmSettingsPage === 'speed' ? 'Speed' : gmSettingsPage === 'quality' ? 'Quality' : gmSettingsPage === 'fit' ? 'Video fit' : 'Tools'}</span>
        </button>
        {#if gmSettingsPage === 'speed'}
          {#each speeds as s, i}
            <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === i + 1} class:text-black={gmSetIdx === i + 1} onclick={() => setSpeed(s)}>{s}×</button>
          {/each}
        {:else if gmSettingsPage === 'quality'}
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 1} class:text-black={gmSetIdx === 1} onclick={() => setVideoQuality('auto')}>Auto</button>
          {#each qualityInfo.heights as height, i}
            <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === i + 2} class:text-black={gmSetIdx === i + 2} onclick={() => setVideoQuality(height)}>{height}p</button>
          {/each}
        {:else if gmSettingsPage === 'fit'}
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 1} class:text-black={gmSetIdx === 1} onclick={() => setFit('best')}>Best fit</button>
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 2} class:text-black={gmSetIdx === 2} onclick={() => setFit('fill')}>Fill</button>
        {:else}
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 1} class:text-black={gmSetIdx === 1} onclick={() => playerStatsOpen.update((value) => !value)}>{$playerStatsOpen ? 'Hide stats' : 'Show stats'}</button>
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 2} class:text-black={gmSetIdx === 2} onclick={() => setSleep('off')}>Sleep: off</button>
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 3} class:text-black={gmSetIdx === 3} onclick={() => setSleep('15')}>Sleep: 15 min</button>
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 4} class:text-black={gmSetIdx === 4} onclick={() => setSleep('30')}>Sleep: 30 min</button>
          <button data-focusable class="gm-set-row" class:bg-white={gmSetIdx === 5} class:text-black={gmSetIdx === 5} onclick={() => setSleep('end')}>Sleep: episode end</button>
        {/if}
      {/if}
    </div>
    </div>
  {/if}
</div>
