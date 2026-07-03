<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import Controls from './Controls.svelte'
  import { getSkipSegments, type Segment } from '$lib/stremio/aniskip'
  import { playing, nowPlaying, fullscreen, toggleFullscreen, exitFullscreen } from '$lib/player/session'
  import { autoSkip } from '$lib/settings/ui'
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
  let segments = $state<Segment[]>([])
  let chapters = $state<{ time: number; title: string }[]>([])
  let metaLoaded = false
  let loadedKey = ''
  // Segments already auto-skipped this episode (by start time), so seeking back
  // into one lets you actually watch it instead of being bounced out again.
  let autoSkipped = new Set<number>()

  let visible = $state(true)
  let hideT: ReturnType<typeof setTimeout>

  const controlsVisible = $derived(visible || paused || buffering)
  const currentSeg = $derived(segments.find((s) => pos >= s.start && pos <= s.end))

  function poke() {
    visible = true
    clearTimeout(hideT)
    hideT = setTimeout(() => (visible = false), 3000)
  }
  function cmd(name: string, args: string[] = []) {
    invoke('player_command', { name, args }).catch((e) => console.warn('player_command', name, args, e))
  }
  const seekTo = (t: number) => cmd('seek', [Math.max(0, t).toFixed(3), 'absolute+keyframes'])
  async function close() {
    await exitFullscreen()
    playing.set(false)
    invoke('close_player').catch(() => {})
  }

  async function loadMeta() {
    metaLoaded = true
    segments = await getSkipSegments(np.malId, np.episode, dur)
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
    autoSkipped = new Set()
  })

  // Auto-skip: when enabled, seek past a segment the first time the playhead is
  // inside it. Tracked per-segment so a manual seek-back isn't re-skipped.
  $effect(() => {
    if (!$autoSkip) return
    const seg = currentSeg
    if (!seg || autoSkipped.has(seg.start)) return
    autoSkipped.add(seg.start)
    seekTo(seg.end + 0.5)
  })

  onMount(() => {
    const uns = [
      listen<[number, number]>('player-progress', (e) => {
        pos = e.payload[0]
        dur = e.payload[1]
        if (!metaLoaded && dur > 0 && np.malId && np.episode) loadMeta()
      }),
      listen<number>('player-buffer', (e) => (buffer = e.payload)),
      listen<boolean>('player-paused', (e) => (paused = e.payload)),
      listen<boolean>('player-buffering', (e) => (buffering = e.payload)),
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
    else if (e.key === 'ArrowLeft') seekTo(pos - 10)
    else if (e.key === 'ArrowRight') seekTo(pos + 10)
    else if (e.key === 'f') toggleFullscreen()
  }}
/>

<!-- Transparent full-window overlay: mpv shows through, controls composite on top.
     z-20 keeps it below the sidebar nav (z-30) and titlebar (z-50), so those stay
     visible and clickable while playing. Cursor stays visible (mpv autohide off). -->
<div
  class="fixed inset-0 z-20 cursor-auto"
  class:cursor-none={!controlsVisible}
  onclick={() => cmd('cycle', ['pause'])}
  role="presentation"
>
  {#if buffering}
    <div class="pointer-events-none absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/25 border-t-white"></div>
  {/if}

  <!-- Manual Skip button — hidden when auto-skip is on (it fires automatically). -->
  {#if currentSeg && !$autoSkip}
    <button
      data-focusable
      class="absolute bottom-28 right-8 z-10 rounded-lg border border-white/20 bg-black/70 px-5 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-black/90"
      onclick={(e) => { e.stopPropagation(); seekTo(currentSeg.end + 0.5) }}
    >
      Skip {currentSeg.label}
    </button>
  {/if}

  {#if controlsVisible}
    <Controls {pos} {dur} {buffer} {paused} {segments} {chapters} {cmd} onclose={close} />
  {/if}
</div>
