<script lang="ts">
  // izumi's full-window trailer player (`trailerPopup.mode === 'player'`): TV, Game mode, a
  // controller, and desktop unless Settings → Playback asks for the popup (trailerOpensIn). The video
  // players cannot play YouTube, so the embed plays without YouTube's controls and izumi's own drive
  // it over the IFrame API (youtube-channel.ts).
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Pause from '@lucide/svelte/icons/pause'
  import Play from '@lucide/svelte/icons/play'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import VolumeX from '@lucide/svelte/icons/volume-x'
  import { trailerPopup, closeTrailerPopup } from '$lib/stores/trailer'
  import { navLayer } from '$lib/nav/overlay'
  import { isMobile, isTv } from '$lib/platform'
  import { gameMode } from '$lib/player/session'
  import { youtubeEmbedSource, type YoutubeEmbedSource } from './youtube-embed'
  import { readYoutubeMessage, youtubeCommand, youtubeHandshake } from './youtube-channel'

  const STEP = 10
  const trailer = $derived($trailerPopup?.mode === 'player' ? $trailerPopup : null)
  const trailerId = $derived(trailer?.id)
  // Ten-foot sizes on TV and in Game mode. Elsewhere on desktop the titlebar's window buttons stay
  // over the top 32 px (z-50 above this z-[45]), so the top row starts under them.
  const big = $derived($isTv || $gameMode)
  const underTitlebar = $derived(!$isTv && !$gameMode && !$isMobile)
  const iconSize = $derived(big ? 26 : 20)
  const iconButton = $derived(big
    ? 'relative grid size-12 place-items-center rounded-full bg-white/10 transition hover:bg-white/20'
    : 'relative grid size-10 place-items-center rounded-full transition hover:bg-white/15')

  let frame = $state<HTMLIFrameElement>()
  let seekbar = $state<HTMLDivElement>()
  let backButton = $state<HTMLButtonElement>()
  let embed = $state<YoutubeEmbedSource>()
  let failed = $state(false)
  let playerState = $state(-1) // YouTube's: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  let time = $state(0)
  let duration = $state(0)
  let muted = $state(false)
  let dragTime = $state<number | null>(null)
  let idle = $state(false)
  let poll: ReturnType<typeof setInterval> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const playing = $derived(playerState === 1 || playerState === 3)
  const shownTime = $derived(dragTime ?? time)
  const progress = $derived(duration > 0 ? Math.min(100, (shownTime / duration) * 100) : 0)
  // The controls and the cursor hide after 3 s without input, only while it plays.
  const hidden = $derived(idle && playing && dragTime === null)

  $effect(() => {
    const id = trailerId
    embed = undefined
    failed = false
    playerState = -1
    time = 0
    duration = 0
    muted = false
    clearInterval(poll)
    if (!id) return
    wake()
    let cancelled = false
    // With sound, as the popup: where autoplay is refused, Play shows and has focus, so one press starts it.
    void youtubeEmbedSource(id, { controls: false, muted: false })
      .then((source) => { if (!cancelled) embed = source })
      .catch(() => { if (!cancelled) failed = true })
    return () => {
      cancelled = true
      clearInterval(poll)
      clearTimeout(idleTimer)
    }
  })
  $effect(() => {
    if (failed) backButton?.focus({ preventScroll: true })
  })

  function wake() {
    idle = false
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => (idle = true), 3000)
  }
  function send(func: string, args: unknown[] = []) {
    youtubeCommand(frame?.contentWindow, embed, func, args)
  }
  function togglePlay() {
    wake()
    if (!embed || failed) return
    send(playing ? 'pauseVideo' : 'playVideo')
    playerState = playing ? 2 : 1
  }
  function toggleMute() {
    wake()
    send(muted ? 'unMute' : 'mute')
    muted = !muted
  }
  function seekTo(seconds: number) {
    wake()
    if (!duration) return
    time = Math.max(0, Math.min(duration, seconds))
    send('seekTo', [time, true])
  }
  function handshake() {
    clearInterval(poll)
    youtubeHandshake(frame?.contentWindow, embed)
    poll = setInterval(() => youtubeHandshake(frame?.contentWindow, embed), 100)
  }
  function onMessage(e: MessageEvent) {
    const message = readYoutubeMessage(e, frame?.contentWindow, embed)
    if (!message) return
    const { event, info } = message
    if (event === 'onReady') clearInterval(poll)
    if (event === 'onError' || (event === 'initialDelivery' && info.videoData?.isPlayable === false)) {
      failed = true
      return
    }
    if (typeof info.playerState === 'number') playerState = info.playerState
    if (typeof info.currentTime === 'number') time = info.currentTime
    if (info.duration) duration = info.duration
    if (typeof info.muted === 'boolean') muted = info.muted
    // The end returns to where the trailer was opened, rather than leaving YouTube's end screen up.
    if (event === 'infoDelivery' && info.playerState === 0) closeTrailerPopup()
  }
  // Window capture, ahead of the d-pad engine: the pad's arrows are dispatched on window, never on the
  // focused seek bar. Escape, B and remote Back close the nav layer (layers.ts).
  function onKey(e: KeyboardEvent) {
    if (!trailer) return
    wake()
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const key = e.key.toLowerCase()
    const step = document.activeElement === seekbar && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    if (key !== ' ' && key !== 'k' && key !== 'm' && !step) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (step) seekTo(shownTime + (e.key === 'ArrowRight' ? STEP : -STEP))
    else if (key === 'm') { if (!e.repeat) toggleMute() }
    else if (!e.repeat) togglePlay()
  }

  function timeAt(clientX: number) {
    const rect = seekbar!.getBoundingClientRect()
    return duration * Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }
  function grab(e: PointerEvent) {
    if (!duration || e.button !== 0) return
    try { seekbar?.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    dragTime = timeAt(e.clientX)
  }
  function drag(e: PointerEvent) {
    if (dragTime !== null) dragTime = timeAt(e.clientX)
  }
  function release() {
    if (dragTime === null) return
    const target = dragTime
    dragTime = null
    seekTo(target)
  }

  /** Focus starts on Play/Pause, a frame after navLayer has noted the opener it returns focus to. */
  function focusOnOpen(node: HTMLElement) {
    const raf = requestAnimationFrame(() => node.focus({ preventScroll: true }))
    return { destroy: () => cancelAnimationFrame(raf) }
  }

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    const m = Math.floor(s / 60)
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }
</script>

<svelte:window onmessage={onMessage} onkeydowncapture={onKey} />

{#if trailer}
  <!-- Not a top-layer <dialog>: it covers the app shell but stays under the desktop titlebar. -->
  <div data-slot="trailer.player" data-nav-trap data-nav-escape role="dialog" aria-modal="true" aria-label={`${trailer.title} trailer`} tabindex="-1"
       use:navLayer={{ kind: 'trailer-player', onClose: () => closeTrailerPopup(), initialFocus: 'none' }}
       class="fixed inset-0 z-[45] select-none bg-black text-white {hidden ? 'cursor-none' : ''}"
       onpointermove={wake} onpointerdown={wake} onwheel={(e) => e.preventDefault()}>
    <!-- Container units, not vw/vh: the app scales the page with CSS zoom. -->
    <div class="absolute inset-0 grid place-items-center [container-type:size]">
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="relative aspect-video overflow-hidden" style="width:min(100cqw,calc(100cqh*16/9))" onclick={togglePlay}>
        {#if failed}
          <p role="status" class="grid h-full place-items-center text-sm text-white/70">Trailer unavailable</p>
        {:else if embed}
          <!-- 240 px taller than the picture: YouTube letterboxes inside it, and its title bar lands in
               the band this box clips. Clicks pass to the box (play/pause). -->
          <iframe bind:this={frame} title={`${trailer.title} trailer`} src={embed.src} onload={handshake}
                  referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media"
                  class="pointer-events-none absolute left-0 top-1/2 h-[calc(100%+240px)] w-full -translate-y-1/2 border-0"></iframe>
        {/if}
      </div>
    </div>

    <div class="absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 {big ? 'px-8 pb-10 pt-6' : underTitlebar ? 'px-4 pb-8 pt-10' : 'px-4 pb-8 pt-3'}"
         class:opacity-0={hidden}>
      <button bind:this={backButton} data-focusable onclick={() => closeTrailerPopup()} aria-label="Back"
              class="flex shrink-0 items-center gap-1.5 rounded-full bg-black/60 py-2 pl-2.5 pr-3.5 text-sm font-bold transition hover:bg-black/80">
        <ArrowLeft size={iconSize} /><span>Back</span>
      </button>
      <h2 class="min-w-0 truncate font-bold {big ? 'text-2xl' : 'text-lg'}">{trailer.title} · Trailer</h2>
    </div>

    {#if !failed}
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent transition-opacity duration-300 {big ? 'px-8 pb-6 pt-16' : 'px-6 pb-5 pt-20'}"
           class:opacity-0={hidden}>
        <div bind:this={seekbar} data-focusable role="slider" tabindex="0" aria-label="Seek"
             aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(shownTime)} aria-valuetext={`${fmt(shownTime)} of ${fmt(duration)}`}
             class="relative cursor-pointer touch-none rounded-full {big ? 'h-8' : 'h-6'}"
             onpointerdown={grab} onpointermove={drag} onpointerup={release} onpointercancel={() => (dragTime = null)} onlostpointercapture={release}>
          <div class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-white/25 {big ? 'h-2' : 'h-1'}"></div>
          <div class="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white {big ? 'h-2' : 'h-1'}" style:width="{progress}%"></div>
          <div class="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white {big ? 'size-5' : 'size-3.5'}" style:left="{progress}%"></div>
        </div>
        <div class="mt-1 flex items-center {big ? 'gap-4' : 'gap-3'}">
          <button data-focusable class={iconButton} onclick={() => seekTo(shownTime - STEP)} aria-label="Back {STEP} seconds">
            <RotateCcw size={iconSize} /><span class="pointer-events-none absolute inset-0 grid place-items-center pt-[3px] text-[0.55rem] font-bold">{STEP}</span>
          </button>
          <button data-focusable use:focusOnOpen onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
                  class="grid place-items-center rounded-full transition {big ? 'size-16 bg-white text-black' : 'size-10 hover:bg-white/15'}">
            {#if playing}<Pause size={big ? 30 : 22} fill="currentColor" />{:else}<Play size={big ? 30 : 22} fill="currentColor" />{/if}
          </button>
          <button data-focusable class={iconButton} onclick={() => seekTo(shownTime + STEP)} aria-label="Forward {STEP} seconds">
            <RotateCw size={iconSize} /><span class="pointer-events-none absolute inset-0 grid place-items-center pt-[3px] text-[0.55rem] font-bold">{STEP}</span>
          </button>
          <span class="ml-1 font-mono tabular-nums {big ? 'text-base' : 'text-sm'}">{fmt(shownTime)} / {fmt(duration)}</span>
          <button data-focusable class="{iconButton} ml-auto" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {#if muted}<VolumeX size={iconSize} />{:else}<Volume2 size={iconSize} />{/if}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
