<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'

  // `cmd` runs an mpv command; the surrounding page owns the invoke plumbing.
  let {
    title,
    pos,
    dur,
    paused,
    cmd,
    onclose,
  }: {
    title: string
    pos: number
    dur: number
    paused: boolean
    cmd: (name: string, args?: string[]) => void
    onclose: () => void
  } = $props()

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const mm = h ? m.toString().padStart(2, '0') : `${m}`
    return `${h ? `${h}:` : ''}${mm}:${sec.toString().padStart(2, '0')}`
  }

  // Seeking: mpv `seek <target> absolute` jumps to an absolute time in seconds.
  function seek(e: Event) {
    cmd('seek', [(e.target as HTMLInputElement).value, 'absolute'])
  }
  function setVolume(e: Event) {
    cmd('set', ['volume', (e.target as HTMLInputElement).value])
  }

  let volume = $state(100)

  // Track menu (subtitle/audio) — populated lazily from mpv's `track-list`.
  type Track = { id: number; type: string; title?: string; lang?: string; selected?: boolean }
  let tracks = $state<Track[]>([])
  let showTracks = $state(false)

  async function loadTracks() {
    showTracks = !showTracks
    if (!showTracks) return
    try {
      const raw = await invoke<string>('player_get_property', { name: 'track-list' })
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
    // Reflect the new selection locally so the checkmark updates immediately.
    const type = kind === 'sid' ? 'sub' : 'audio'
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: t.id === id } : t))
  }
</script>

<!-- stopPropagation everywhere: control clicks must not bubble to the video
     surface's click-to-pause handler. -->
<div class="pointer-events-auto" onclick={(e) => e.stopPropagation()} role="presentation">
  <!-- Top-left: back button + now-playing title -->
  <button
    data-focusable
    class="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 text-white backdrop-blur transition hover:bg-black/70"
    onclick={onclose}
  >
    <span class="text-lg leading-none">←</span>
    <span class="max-w-[60vw] truncate text-sm font-semibold">{title}</span>
  </button>

  <!-- Bottom control bar -->
  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-6 pb-6 pt-16">
    <!-- Seek slider -->
    <input
      data-focusable
      type="range"
      class="accent-theme h-1.5 w-full cursor-pointer"
      min="0"
      max={dur || 0}
      step="1"
      value={pos}
      oninput={seek}
      aria-label="Seek"
    />

    <div class="mt-3 flex items-center gap-4 text-white">
      <button data-focusable class="rounded px-2 py-1 text-sm transition hover:bg-white/15" onclick={() => cmd('seek', ['-10'])} aria-label="Back 10 seconds">-10</button>
      <button data-focusable class="rounded-full px-2 py-1 text-2xl leading-none transition hover:bg-white/15" onclick={() => cmd('cycle', ['pause'])} aria-label={paused ? 'Play' : 'Pause'}>
        {paused ? '▶' : '⏸'}
      </button>
      <button data-focusable class="rounded px-2 py-1 text-sm transition hover:bg-white/15" onclick={() => cmd('seek', ['10'])} aria-label="Forward 10 seconds">+10</button>

      <span class="ml-1 select-none font-mono text-sm tabular-nums">{fmt(pos)} / {fmt(dur)}</span>

      <div class="ml-auto flex items-center gap-4">
        <!-- Volume -->
        <div class="flex items-center gap-2">
          <span class="text-sm" aria-hidden="true">🔊</span>
          <input
            data-focusable
            type="range"
            class="accent-theme h-1 w-24 cursor-pointer"
            min="0"
            max="130"
            step="1"
            bind:value={volume}
            oninput={setVolume}
            aria-label="Volume"
          />
        </div>

        <!-- Subtitle / audio track menu -->
        <div class="relative">
          <button data-focusable class="rounded px-2 py-1 text-sm transition hover:bg-white/15" onclick={loadTracks} aria-label="Subtitle and audio tracks">CC</button>
          {#if showTracks}
            <div class="absolute bottom-full right-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-lg bg-black/90 p-2 text-sm shadow-xl backdrop-blur">
              <p class="px-2 py-1 text-xs uppercase tracking-wide text-white/50">Subtitles</p>
              <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('sid', 0)}>None</button>
              {#each subs as t (t.id)}
                <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('sid', t.id)}>
                  {t.selected ? '✓ ' : ''}{label(t)}
                </button>
              {/each}
              {#if audios.length > 1}
                <p class="mt-1 px-2 py-1 text-xs uppercase tracking-wide text-white/50">Audio</p>
                {#each audios as t (t.id)}
                  <button data-focusable class="block w-full rounded px-2 py-1 text-left transition hover:bg-white/15" onclick={() => pick('aid', t.id)}>
                    {t.selected ? '✓ ' : ''}{label(t)}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
