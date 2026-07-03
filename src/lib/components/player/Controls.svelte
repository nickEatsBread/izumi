<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import type { Segment } from '$lib/stremio/aniskip'
  import Seekbar from './Seekbar.svelte'
  import Play from 'lucide-svelte/icons/play'
  import Pause from 'lucide-svelte/icons/pause'
  import Volume2 from 'lucide-svelte/icons/volume-2'
  import VolumeX from 'lucide-svelte/icons/volume-x'
  import Captions from 'lucide-svelte/icons/captions'
  import Maximize from 'lucide-svelte/icons/maximize'
  import Minimize from 'lucide-svelte/icons/minimize'
  import Settings from 'lucide-svelte/icons/settings-2'
  import { fullscreen, toggleFullscreen } from '$lib/player/session'

  // `cmd` runs an mpv command; the page owns the invoke plumbing + live state.
  let {
    pos,
    dur,
    buffer,
    paused,
    segments,
    chapters,
    cmd,
    onclose,
  }: {
    pos: number
    dur: number
    buffer: number
    paused: boolean
    segments: Segment[]
    chapters: { time: number; title: string }[]
    cmd: (name: string, args?: string[]) => void
    onclose: () => void
  } = $props()

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const mm = h ? String(m).padStart(2, '0') : `${m}`
    return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
  }

  // Commit a single absolute (keyframe) seek — fast for remote streams, and one
  // seek instead of a stream of them so mpv doesn't loop over the cached window.
  const seekTo = (t: number) => cmd('seek', [t.toFixed(3), 'absolute+keyframes'])

  // Playback options menu (speed / delays / subtitle size).
  let showOptions = $state(false)
  let speed = $state(1)
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; cmd('set', ['speed', String(v)]) }
  const adjust = (prop: string, delta: number) => cmd('add', [prop, String(delta)])

  let volume = $state(100)
  let muted = $state(false)
  function setVolume(e: Event) {
    volume = Number((e.target as HTMLInputElement).value)
    muted = volume === 0
    cmd('set', ['volume', String(volume)])
  }
  function toggleMute() {
    muted = !muted
    cmd('set', ['mute', muted ? 'yes' : 'no'])
  }

  // Track menu (subtitle/audio) — populated lazily from mpv's track-list.
  type Track = { id: number; type: string; title?: string; lang?: string; selected?: boolean }
  let tracks = $state<Track[]>([])
  let showTracks = $state(false)
  async function loadTracks() {
    showTracks = !showTracks
    if (!showTracks) return
    try {
      const raw = await invoke<string>('player_tracks')
      tracks = JSON.parse(raw) as Track[]
    }
    catch (e) {
      console.warn('track-list unavailable', e)
      tracks = []
    }
  }
  const subs = $derived(tracks.filter((t) => t.type === 'sub'))
  const audios = $derived(tracks.filter((t) => t.type === 'audio'))
  const label = (t: Track) => t.title || t.lang || `Track ${t.id}`
  function pick(kind: 'sid' | 'aid', id: number) {
    cmd('set', [kind, String(id)])
    const type = kind === 'sid' ? 'sub' : 'audio'
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: t.id === id } : t))
  }
</script>

<!-- stopPropagation: control clicks must not bubble to the video click-to-pause. -->
<div class="pointer-events-none absolute inset-0" onclick={(e) => e.stopPropagation()} role="presentation">
  <!-- Top-left: back button (icon only — no series title) -->
  <button
    data-focusable
    class="pointer-events-auto absolute left-4 top-4 grid size-10 place-items-center rounded-lg bg-black/50 text-white backdrop-blur transition hover:bg-black/70"
    onclick={onclose}
    aria-label="Back"
  >
    <span class="text-lg leading-none">←</span>
  </button>

  <!-- Bottom control bar -->
  <div class="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-6 pb-5 pt-20">
    <Seekbar {pos} {dur} {buffer} {segments} {chapters} onseek={seekTo} />

    <div class="mt-1 flex items-center gap-3 text-white">
      <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={() => cmd('cycle', ['pause'])} aria-label={paused ? 'Play' : 'Pause'}>
        {#if paused}<Play size={22} fill="currentColor" />{:else}<Pause size={22} fill="currentColor" />{/if}
      </button>
      <button data-focusable class="rounded px-2 py-1 text-sm transition hover:bg-white/15" onclick={() => seekTo(Math.max(0, pos - 10))} aria-label="Back 10 seconds">-10</button>
      <button data-focusable class="rounded px-2 py-1 text-sm transition hover:bg-white/15" onclick={() => seekTo(pos + 10)} aria-label="Forward 10 seconds">+10</button>

      <span class="ml-1 select-none font-mono text-sm tabular-nums">{fmt(pos)} / {fmt(dur)}</span>

      <div class="ml-auto flex items-center gap-3">
        <!-- Volume -->
        <div class="group/vol flex items-center gap-1">
          <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {#if muted}<VolumeX size={20} />{:else}<Volume2 size={20} />{/if}
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

        <!-- Playback options: speed, audio/subtitle delay, subtitle size -->
        <div class="relative">
          <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={() => (showOptions = !showOptions)} aria-label="Playback options"><Settings size={20} /></button>
          {#if showOptions}
            <div class="absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-black/90 p-3 text-sm text-white shadow-xl backdrop-blur">
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Speed</p>
              <div class="mb-3 flex flex-wrap gap-1">
                {#each speeds as s}
                  <button data-focusable onclick={() => setSpeed(s)} class="rounded px-2 py-1 text-xs transition {speed === s ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{s}×</button>
                {/each}
              </div>
              {#each [['Subtitle delay', 'sub-delay'], ['Audio delay', 'audio-delay'], ['Subtitle size', 'sub-scale']] as [label, prop]}
                <div class="flex items-center justify-between gap-2 py-0.5">
                  <span>{label}</span>
                  <span class="flex gap-1">
                    <button data-focusable onclick={() => adjust(prop, -0.1)} class="grid size-6 place-items-center rounded bg-white/10 hover:bg-white/20" aria-label="Decrease {label}">−</button>
                    <button data-focusable onclick={() => adjust(prop, 0.1)} class="grid size-6 place-items-center rounded bg-white/10 hover:bg-white/20" aria-label="Increase {label}">+</button>
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Subtitle / audio track menu -->
        <div class="relative">
          <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={loadTracks} aria-label="Subtitle and audio tracks"><Captions size={20} /></button>
          {#if showTracks}
            <div class="absolute bottom-full right-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-lg bg-black/90 p-2 text-sm text-white shadow-xl backdrop-blur">
              <p class="px-2 py-1 text-xs uppercase tracking-wide text-white/50">Audio</p>
              {#if audios.length}
                {#each audios as t (t.id)}
                  <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('aid', t.id)}>
                    {t.selected ? '✓ ' : ''}{label(t)}
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
                  {t.selected ? '✓ ' : ''}{label(t)}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Fullscreen (user-initiated; player opens windowed) -->
        <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={toggleFullscreen} aria-label="Toggle fullscreen">
          {#if $fullscreen}<Minimize size={20} />{:else}<Maximize size={20} />{/if}
        </button>
      </div>
    </div>
  </div>
</div>
