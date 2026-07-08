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
  import SkipBack from 'lucide-svelte/icons/skip-back'
  import SkipForward from 'lucide-svelte/icons/skip-forward'
  import Camera from 'lucide-svelte/icons/camera'
  import ArrowLeft from 'lucide-svelte/icons/arrow-left'
  import { fullscreen, toggleFullscreen, nowPlaying, playerNotice } from '$lib/player/session'
  import { videoFit } from '$lib/settings/ui'
  import { playPrev, playNext } from '$lib/stremio/play'

  const np = $derived($nowPlaying)
  const hasPrev = $derived(np.episode != null && np.episode > 1)
  const hasNext = $derived(np.episode != null && np.airedTotal != null && np.episode < np.airedTotal)

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
    gm = false,
    ontoggleplay,
  }: {
    pos: number
    dur: number
    buffer: number
    paused: boolean
    segments: Segment[]
    chapters: { time: number; title: string }[]
    cmd: (name: string, args?: string[]) => void
    onclose: () => void
    // Game mode (Deck/gamescope touch player): no windowed/fullscreen toggle, and the
    // play button must swap the fullscreen video back in (not just unpause under a black
    // screen). `ontoggleplay` overrides the default cycle-pause when provided.
    gm?: boolean
    ontoggleplay?: () => void
  } = $props()
  const togglePlay = () => (ontoggleplay ? ontoggleplay() : cmd('cycle', ['pause']))

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
  const seekTo = (t: number) => cmd('seek', [t.toFixed(3), 'absolute+exact'])

  // Playback options menu (speed / fit / delays / subtitle size).
  let showOptions = $state(false)
  let speed = $state(1)
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
  function setSpeed(v: number) { speed = v; cmd('set', ['speed', String(v)]) }
  const adjust = (prop: string, delta: number) => cmd('add', [prop, String(delta)])

  // Video fit: 'best' = letterbox (panscan 0); 'fill' = crop-to-fill (panscan 1),
  // aspect preserved either way (never stretched). Persisted + applied live.
  function setFit(f: 'best' | 'fill') { videoFit.set(f); cmd('set', ['panscan', f === 'fill' ? '1.0' : '0.0']) }

  // Screenshot the current frame (with subtitles) → app Pictures/izumi folder.
  async function screenshot() {
    try { await invoke('player_screenshot'); playerNotice.set('Screenshot saved to Pictures/izumi') }
    catch { playerNotice.set('Screenshot failed') }
  }

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
  type Track = {
    id: number; type: string; title?: string; lang?: string; selected?: boolean
    codec?: string; channels?: number; default?: boolean; forced?: boolean
  }
  let tracks = $state<Track[]>([])
  let showTracks = $state(false)
  async function loadTracks() {
    showOptions = false // only one popover open at a time
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

  // Disambiguating label: two tracks that SHARE a name/lang (the "Your Name" case —
  // several "English" audio tracks) get their codec + channels appended so they're
  // distinguishable, plus Default/Forced flags. Channels always shown for audio.
  const chLabel = (n?: number) =>
    !n ? '' : n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? '2.0' : n === 1 ? 'Mono' : `${n}ch`
  const baseOf = (t: Track) => t.title?.trim() || (t.lang ? t.lang.toUpperCase() : `Track ${t.id}`)
  function label(t: Track, group: Track[] = tracks): string {
    const base = baseOf(t)
    const collide = group.filter((o) => baseOf(o) === base).length > 1
    const bits: string[] = []
    if (collide && t.codec) bits.push(t.codec.toUpperCase())
    if (t.type === 'audio') { const c = chLabel(t.channels); if (c) bits.push(c) }
    if (t.forced) bits.push('Forced')
    if (t.default) bits.push('Default')
    return bits.length ? `${base} · ${bits.join(' ')}` : base
  }
  function pick(kind: 'sid' | 'aid', id: number) {
    cmd('set', [kind, String(id)])
    const type = kind === 'sid' ? 'sub' : 'audio'
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: t.id === id } : t))
  }
</script>

<!-- stopPropagation: control clicks must not bubble to the video click-to-pause. -->
<div class="pointer-events-none absolute inset-0" onclick={(e) => e.stopPropagation()} role="presentation">
  <!-- Back: leave the player and return to the page underneath (the series page). Top-left over
       a short gradient so it's legible on bright frames. Shown on Desktop AND Game mode (the Deck
       B button does the same) — previously there was no in-player exit control at all. -->
  <div class="pointer-events-auto absolute inset-x-0 top-0 flex items-center bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
    <button data-focusable onclick={onclose} aria-label="Back"
            class="flex items-center gap-1.5 rounded-full bg-black/40 py-2 pl-2.5 pr-3.5 text-sm font-bold text-white backdrop-blur transition hover:bg-black/70">
      <ArrowLeft size={20} /> Back
    </button>
  </div>

  <!-- Bottom control bar: a gradient that floats over the video. Works identically on Desktop
       (subsurface below the webview) and Game mode (gamescope layer-shell surface below the
       webview) — the compositor blends the transparent webview over the video either way. -->
  <div class="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-6 pb-5 pt-20">
    <!-- Now-playing title (bottom-left, above the seekbar) -->
    {#if np.animeTitle}
      <div class="mb-2 flex flex-col gap-0.5 [text-shadow:0_1px_4px_rgba(0,0,0,.6)]">
        <span class="line-clamp-1 text-lg font-semibold text-white">{np.animeTitle}</span>
        {#if np.episode != null}
          <span class="text-sm font-light text-white/60">Episode {np.episode}{np.total ? ` / ${np.total}` : ''}</span>
        {/if}
      </div>
    {/if}

    <Seekbar {pos} {dur} {buffer} {segments} {chapters} {gm} onseek={seekTo} />

    <div class="mt-1 flex items-center gap-3 text-white">
      {#if hasPrev}
        <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={() => playPrev()} aria-label="Previous episode"><SkipBack size={20} fill="currentColor" /></button>
      {/if}
      <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
        {#if paused}<Play size={22} fill="currentColor" />{:else}<Pause size={22} fill="currentColor" />{/if}
      </button>
      {#if hasNext}
        <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={() => playNext()} aria-label="Next episode"><SkipForward size={20} fill="currentColor" /></button>
      {/if}

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
          <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={() => { showOptions = !showOptions; showTracks = false }} aria-label="Playback options"><Settings size={20} /></button>
          {#if showOptions}
            <!-- NO backdrop-blur: backdrop-filter samples pixels behind the element, but the
                 video is a separate Wayland subsurface the webview can't see, so it blurs an
                 empty/black backdrop → dark ghost boxes. Promote to its own compositing layer
                 (translateZ/will-change) so show/hide is a clean recomposite, not a parent-
                 layer repaint that never clears. -->
            <div class="absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-neutral-900/95 p-3 text-sm text-white shadow-xl [transform:translateZ(0)] [will-change:transform]">
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Speed</p>
              <div class="mb-3 flex flex-wrap gap-1">
                {#each speeds as s}
                  <button data-focusable onclick={() => setSpeed(s)} class="rounded px-2 py-1 text-xs transition {speed === s ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{s}×</button>
                {/each}
              </div>
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Video fit</p>
              <div class="mb-3 flex gap-1">
                {#each [['best', 'Best fit'], ['fill', 'Fill']] as [v, l]}
                  <button data-focusable onclick={() => setFit(v as 'best' | 'fill')} class="flex-1 rounded px-2 py-1 text-xs transition {$videoFit === v ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{l}</button>
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
            <div class="absolute bottom-full right-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-lg bg-neutral-900/95 p-2 text-sm text-white shadow-xl [transform:translateZ(0)] [will-change:transform]">
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
            </div>
          {/if}
        </div>

        <!-- Screenshot the current frame → Pictures/izumi -->
        <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={screenshot} aria-label="Screenshot"><Camera size={20} /></button>

        <!-- Fullscreen (user-initiated; player opens windowed). Hidden in game mode —
             the Deck player is always fullscreen, there is no windowed state. -->
        {#if !gm}
          <button data-focusable class="grid size-10 place-items-center rounded-full transition hover:bg-white/15" onclick={toggleFullscreen} aria-label="Toggle fullscreen">
            {#if $fullscreen}<Minimize size={20} />{:else}<Maximize size={20} />{/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
