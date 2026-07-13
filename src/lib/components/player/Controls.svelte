<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import type { Segment } from '$lib/stremio/aniskip'
  import Seekbar from './Seekbar.svelte'
  import Play from 'lucide-svelte/icons/play'
  import Pause from 'lucide-svelte/icons/pause'
  import Volume2 from 'lucide-svelte/icons/volume-2'
  import VolumeX from 'lucide-svelte/icons/volume-x'
  import Captions from 'lucide-svelte/icons/captions'
  import MessageSquare from 'lucide-svelte/icons/message-square'
  import Maximize from 'lucide-svelte/icons/maximize'
  import Minimize from 'lucide-svelte/icons/minimize'
  import Settings from 'lucide-svelte/icons/settings-2'
  import SkipBack from 'lucide-svelte/icons/skip-back'
  import SkipForward from 'lucide-svelte/icons/skip-forward'
  import Camera from 'lucide-svelte/icons/camera'
  import ArrowLeft from 'lucide-svelte/icons/arrow-left'
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import Check from 'lucide-svelte/icons/check'
  import { get } from 'svelte/store'
  import { fullscreen, toggleFullscreen, nowPlaying, playerNotice, playerMenuOpen, nowPlayingMedia, commentsOpen } from '$lib/player/session'
  import { commentsEnabled } from '$lib/comments'
  import { videoFit, playerTitleTop } from '$lib/settings/ui'
  import { playPrev, playNext, playEpisode } from '$lib/stremio/play'

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

  // Game mode (Deck) scales the controls up for a touchscreen at arm's length: bigger
  // secondary icon buttons + icons, and the title can move to the top of the player.
  const iconBtn = $derived(`grid place-items-center rounded-full transition hover:bg-white/15 ${gm ? 'size-12' : 'size-10'}`)
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
  const seekTo = (t: number) => cmd('seek', [t.toFixed(3), 'absolute+exact'])

  // Game mode: changing episode needs a DOUBLE press (touch double-tap, or two quick A presses on
  // the controller) so a stray tap can't jump episodes. The first press arms + shows a hint; a
  // second in the same direction within the window commits. Desktop keeps single-click.
  let epArm = 0
  let epArmDir: 1 | -1 = 1
  function episodeStep(dir: 1 | -1) {
    const now = performance.now()
    if (epArm && epArmDir === dir && now - epArm < 1400) {
      epArm = 0
      if (dir > 0) playNext(); else playPrev()
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
  const adjust = (prop: string, delta: number) => cmd('add', [prop, String(delta)])

  // Change source: re-open the source picker for the CURRENTLY-playing episode. Picking a new
  // source swaps the stream in place (playStream loads it into the running player).
  function changeSource() {
    showOptions = false
    const np = get(nowPlayingMedia)
    if (np) playEpisode(np.media, np.episode, () => {})
  }

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
  // Desktop track menu is a two-level drill-down (root [Audio, Subtitles] → the chosen
  // category's list) with a Miller-column slide. `menuLevel`/`detailCat` drive the slide;
  // `rootH`/`detailH` are the measured column heights so the panel morphs to fit.
  let menuLevel = $state<'root' | 'detail'>('root')
  let detailCat = $state<'audio' | 'subs'>('audio')
  let rootH = $state(0), detailH = $state(0)
  async function loadTracks() {
    showOptions = false // only one popover open at a time
    showTracks = !showTracks
    menuLevel = 'root'
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

  // Desktop drill-down helpers. `detailItems` is the chosen category's track list;
  // `curLabel` is what shows on the collapsed root row for each category (the active
  // track, or "Off"). `pickLeaf` sets the track then slides back to the root.
  const detailItems = $derived(detailCat === 'audio' ? audios : subs)
  const detailTitle = $derived(detailCat === 'audio' ? 'Audio' : 'Subtitles')
  const leafKind = $derived<'aid' | 'sid'>(detailCat === 'audio' ? 'aid' : 'sid')
  const detailOff = $derived(!detailItems.some((t) => t.selected)) // nothing selected ⇒ "Off" is active
  const curLabel = (group: Track[]) => {
    const on = group.find((t) => t.selected)
    return on ? label(on, group) : 'Off'
  }
  const curAudioLabel = $derived(curLabel(audios))
  const curSubLabel = $derived(curLabel(subs))
  function openDetail(cat: 'audio' | 'subs') {
    detailCat = cat
    menuLevel = 'detail'
  }
  // Disable the category (mpv uses aid/sid = "no"; 0 isn't a valid track id).
  function pickOff() {
    const type = detailCat === 'audio' ? 'audio' : 'sub'
    cmd('set', [leafKind, 'no'])
    tracks = tracks.map((t) => (t.type === type ? { ...t, selected: false } : t))
  }

  // Drive the Game-mode snapshot overlay to its fast (60fps) cadence while a popover is open so
  // navigating it isn't laggy. The cleanup resets on unmount so the flag can't stick true.
  $effect(() => {
    playerMenuOpen.set(showOptions || showTracks)
    return () => playerMenuOpen.set(false)
  })
</script>

<!-- Now-playing title, reused above the seek bar (default) or at the top (Game-mode option). -->
{#snippet titleBlock(big: boolean)}
  {#if np.animeTitle}
    <div class="flex min-w-0 flex-col gap-0.5 [text-shadow:0_1px_4px_rgba(0,0,0,.6)]">
      <span class="line-clamp-1 font-semibold text-white {big ? 'text-2xl' : 'text-lg'}">{np.animeTitle}</span>
      {#if np.episode != null}
        <span class="font-light text-white/60 {big ? 'text-base' : 'text-sm'}">Episode {np.episode}{np.total ? ` / ${np.total}` : ''}</span>
      {/if}
    </div>
  {/if}
{/snippet}

<!-- stopPropagation: control clicks must not bubble to the video click-to-pause. -->
<div class="pointer-events-none absolute inset-0" onclick={(e) => e.stopPropagation()} role="presentation">
  <!-- Top bar: Back button (Desktop only — Game mode uses the B button to leave, so no
       redundant on-screen Back) and, when the Game-mode "title at top" option is on, the
       title. Rendered only when it has something to show. -->
  {#if !gm || titleTop}
    <!-- Windowed playback keeps the custom titlebar (a fixed top-0 z-50 `data-tauri-drag-region`
         strip, 32px tall) ABOVE this z-20 overlay — its transparent drag region covered the top of
         the Back button, so a click on the (vertically-centred) label hit the window-drag region,
         not the button. Push the bar below the titlebar when windowed so the whole button clears it.
         Fullscreen / Game mode hide the titlebar, so no offset there. -->
    <div class="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/70 to-transparent {gm ? 'px-8 py-6' : $fullscreen ? 'px-4 py-3' : 'px-4 pb-3 pt-11'}">
      {#if !gm}
        <button data-focusable onclick={onclose} aria-label="Back"
                class="flex shrink-0 select-none items-center gap-1.5 rounded-full bg-black/60 py-2 pl-2.5 pr-3.5 text-sm font-bold text-white transition hover:bg-black/80">
          <ArrowLeft size={icSize} /><span>Back</span>
        </button>
      {/if}
      {#if titleTop}<div class="min-w-0 flex-1">{@render titleBlock(true)}</div>{/if}
    </div>
  {/if}

  <!-- Bottom control bar: a gradient that floats over the video. Works identically on Desktop
       (subsurface below the webview) and Game mode (gamescope layer-shell surface below the
       webview) — the compositor blends the transparent webview over the video either way. -->
  <div class="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-6 pb-5 pt-20">
    <!-- Now-playing title above the seek bar (unless it's been moved to the top). Scales up
         in Game mode to match the enlarged controls. -->
    {#if !titleTop}
      <div class="mb-2">{@render titleBlock(gm)}</div>
    {/if}

    <!-- Game mode: flank the bar with current + total time (Crunchy-Deck style) so the bar itself
         is narrower; Desktop keeps the full-width bar with the time in the button row. -->
    {#if gm}
      <div class="flex items-center gap-3">
        <span class="w-16 shrink-0 select-none text-right font-mono text-base tabular-nums text-white/85">{fmt(pos)}</span>
        <div class="min-w-0 flex-1"><Seekbar {pos} {dur} {buffer} {segments} {chapters} {gm} onseek={seekTo} /></div>
        <span class="w-16 shrink-0 select-none font-mono text-base tabular-nums text-white/60">{fmt(dur)}</span>
      </div>
    {:else}
      <Seekbar {pos} {dur} {buffer} {segments} {chapters} {gm} onseek={seekTo} />
    {/if}

    <div class="mt-1 flex items-center gap-3 text-white {gm ? 'gap-4' : ''}">
      {#if hasPrev}
        <button data-focusable class={iconBtn} onclick={() => (gm ? episodeStep(-1) : playPrev())} aria-label="Previous episode"><SkipBack size={icSize} fill="currentColor" /></button>
      {/if}
      <!-- Play/pause: Game mode gets a filled white circle (no outline) — the primary,
           thumb-sized touch target; Desktop keeps the subtle hover-only button. -->
      <button data-focusable onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}
              class="grid place-items-center rounded-full focus-ring-inset {gm ? 'size-16 bg-white text-black' : 'size-10 transition hover:bg-white/15'}">
        {#if paused}<Play size={gm ? 30 : 22} fill="currentColor" />{:else}<Pause size={gm ? 30 : 22} fill="currentColor" />{/if}
      </button>
      {#if hasNext}
        <button data-focusable class={iconBtn} onclick={() => (gm ? episodeStep(1) : playNext())} aria-label="Next episode"><SkipForward size={icSize} fill="currentColor" /></button>
      {/if}

      <!-- Desktop shows the time here; Game mode moved it to flank the bar (above). -->
      {#if !gm}
        <span class="ml-1 select-none font-mono tabular-nums text-sm">{fmt(pos)} / {fmt(dur)}</span>
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
          <button data-focusable class={iconBtn} onclick={() => { showOptions = !showOptions; showTracks = false }} aria-label="Playback options"><Settings size={icSize} /></button>
          {#if showOptions}
            <!-- NO backdrop-blur (video is a separate surface the webview can't sample → blurs
                 black). Desktop promotes to its own compositing layer (translateZ/will-change) so
                 show/hide is a clean recomposite. Game mode must NOT promote: the controls are
                 snapshotted into mpv and a promoted layer captures as PIXELATED text (WebKit
                 composites it separately, grayscale-AA + resample); an OPAQUE background keeps it
                 on the crisp base layer, and the {#if} unmount handles the trail there. -->
            <div class="absolute bottom-full right-0 mb-2 w-64 rounded-lg bg-neutral-900 p-3 text-sm text-white shadow-xl {gm ? '' : '[transform:translateZ(0)] [will-change:transform]'}">
              <button data-focusable onclick={changeSource} class="mb-3 w-full rounded bg-white/10 px-2.5 py-2 text-left text-sm font-bold transition hover:bg-white/20">Change source…</button>
              <p class="mb-1 text-xs uppercase tracking-wide text-white/50">Speed</p>
              <!-- Fixed 6-col grid so all speeds sit on ONE even row (flex-wrap dropped "2×"
                   onto a lonely second line). -->
              <div class="mb-3 grid grid-cols-6 gap-1">
                {#each speeds as s}
                  <button data-focusable onclick={() => setSpeed(s)} class="rounded py-1 text-center text-xs tabular-nums transition {speed === s ? 'bg-primary text-primary-foreground' : 'hover:bg-white/15'}">{s}×</button>
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

        <!-- Discussion / comments panel toggle (keyed on the playing episode). -->
        {#if $commentsEnabled}
          <button data-focusable class={iconBtn} onclick={() => { commentsOpen.set(!$commentsOpen); showOptions = false; showTracks = false }}
                  aria-label="Discussion" aria-pressed={$commentsOpen}>
            <MessageSquare size={icSize} class={$commentsOpen ? 'text-theme' : ''} />
          </button>
        {/if}

        <!-- Subtitle / audio track menu -->
        <div class="relative">
          <button data-focusable class={iconBtn} onclick={loadTracks} aria-label="Subtitle and audio tracks"><Captions size={icSize} /></button>
          {#if showTracks}
            {#if gm}
              <!-- Game mode keeps the flat, tap-friendly list (the ☰ TrackMenu is the primary
                   Deck path; this popover is the fallback and stays snapshot-crisp with no promoted layer). -->
              <div class="absolute bottom-full right-0 mb-2 max-h-72 w-56 overflow-y-auto rounded-lg bg-neutral-900 p-2 text-sm text-white shadow-xl">
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
                    </div>
                    <!-- DETAIL: the chosen category's list -->
                    <div class="w-1/2 p-2" bind:clientHeight={detailH}>
                      <button data-focusable class="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left font-semibold transition hover:bg-white/10" onclick={() => (menuLevel = 'root')}>
                        <ChevronLeft size={18} class="shrink-0 text-white/60" />
                        {detailTitle}
                      </button>
                      <div class="max-h-64 overflow-y-auto">
                        <!-- "Off" leaf (disable this category) -->
                        <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={pickOff}>
                          <span class="truncate text-white/70">Off</span>
                          {#if detailOff}<Check size={18} class="shrink-0 text-primary" />{/if}
                        </button>
                        {#if detailItems.length}
                          {#each detailItems as t (t.id)}
                            <button data-focusable class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-white/10" onclick={() => pick(leafKind, t.id)}>
                              <span class="truncate">{label(t, detailItems)}</span>
                              {#if t.selected}<Check size={18} class="shrink-0 text-primary" />{/if}
                            </button>
                          {/each}
                        {:else}
                          <p class="px-3 py-2 text-white/40">No {detailTitle.toLowerCase()} tracks</p>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          {/if}
        </div>

        <!-- Screenshot the current frame → Pictures/izumi. Desktop only in Game mode we keep the
             bar to just Subtitles + options (the Deck has its own Steam screenshot shortcut). -->
        {#if !gm}
          <button data-focusable class={iconBtn} onclick={screenshot} aria-label="Screenshot"><Camera size={icSize} /></button>
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
</div>
