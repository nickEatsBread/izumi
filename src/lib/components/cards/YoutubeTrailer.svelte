<script module lang="ts">
  // Fade-out and fade-in can briefly leave two preview components mounted. Only the most recently
  // mounted trailer owns the global M shortcut so one keypress can never toggle the shared state
  // twice and appear to do nothing.
  const activeKeyboardTrailers: symbol[] = []
</script>

<script lang="ts">
  // Muted autoplay YouTube trailer for the hover preview. Desktop WebViews with a non-HTTP app
  // origin use a loopback document so YouTube receives the HTTP embedder identity it requires.
  import { onMount, untrack } from 'svelte'
  import VolumeX from '@lucide/svelte/icons/volume-x'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import type { Writable } from 'svelte/store'
  import { hoverTrailers, trailerMuted as hoverTrailerMuted, openTrailerPopup, trailerPopup } from '$lib/stores/trailer'
  import {
    youtubeEmbedSource,
    youtubePlayerOrigins,
    type YoutubeEmbedSource,
  } from './youtube-embed'
  import { parkPlayer, takePlayer } from './youtube-pool'
  // The defaults are the hover preview; BackdropTrailer plays once (`loop: false`), covers its box,
  // follows its own session mute store and listens for the start and the end (`natural` = the video
  // reached its end, false = it failed). `wait` keeps the picture hidden while it is true, so a host can load
  // and start the video early and show it later.
  let { id, title = 'Trailer', loop = true, fit = 'crop', mutePart, muteClass = 'right-1 top-1 z-10', trailerMuted = hoverTrailerMuted, wait = false, onplaying, onended }: {
    id: string; title?: string; loop?: boolean; fit?: 'crop' | 'cover'; mutePart?: string; muteClass?: string
    trailerMuted?: Writable<boolean>; wait?: boolean; onplaying?: () => void; onended?: (natural: boolean) => void
  } = $props()
  // `cover` fills its own size container (`container-type: size`) at 16:9; the extra 240 px letterboxes
  // YouTube's own title and branding above and below the picture, where the box's overflow cuts them.
  const COVER_STYLE = 'width:max(100cqw,calc(100cqh*16/9));height:calc(max(56.25cqw,100cqh) + 240px)'

  let frame = $state<HTMLIFrameElement>()
  let host = $state<HTMLElement>()
  let playing = $state(false)
  let dead = $state(false)
  let embed = $state<YoutubeEmbedSource>()
  let poll: ReturnType<typeof setInterval> | undefined
  let ended = false // YouTube can repeat ENDED; a play-once trailer reports it once
  const keyboardOwner = Symbol('hover-trailer')
  // YouTube's player draws its own controls (a play/pause button on a dark scrim) until 4 s after
  // every start of playback, the first one and each restart, and while it buffers or has ended,
  // whatever `controls=0` says. So the picture fades in once playback has run 4.5 s, fades out just
  // before the end, and drops at once when playback stops early (a stall). `playing` (the mute
  // button, `onplaying`) waits for the first reveal, and no reveal happens while the host says `wait`.
  const CONTROLS_SETTLE_MS = 4500
  let settled = $state(false) // playback has run CONTROLS_SETTLE_MS since it last started
  let shown = $state(false)
  let fading = $state(false) // the opacity change animates: a reveal, or the fade before the end
  let duration = 0
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  function settle(running: boolean) {
    if (!running) {
      clearTimeout(revealTimer)
      revealTimer = undefined
      settled = false
      fading = false
      shown = false
      return
    }
    if (settled || revealTimer) return
    revealTimer = setTimeout(() => {
      revealTimer = undefined
      settled = true
    }, CONTROLS_SETTLE_MS)
  }
  $effect(() => {
    if (!settled || wait) return
    untrack(() => {
      fading = true
      shown = true
      if (!playing) { playing = true; onplaying?.() }
    })
  })

  $effect(() => {
    const videoId = id
    let cancelled = false
    embed = undefined
    settle(false)
    duration = 0
    playing = false
    dead = false
    ended = false
    clearInterval(poll)
    void youtubeEmbedSource(videoId, { controls: false, muted: true })
      .then((source) => { if (!cancelled) embed = source })
      .catch(() => { if (!cancelled) fail() })
    return () => { cancelled = true }
  })

  // Apply the session-wide mute state to THIS trailer whenever it (or the shared
  // state) changes — so unmuting one card carries to every trailer you hover next.
  $effect(() => {
    if (playing) send($trailerMuted ? 'mute' : 'unMute')
  })

  // A backdrop trailer's mute button fades away (`data-idle`) after 3 s without pointer or key input
  // and comes back on the next one; keyboard focus keeps it. Reduced motion drops the fade (app.css).
  let idle = $state(false)
  let focusVisible = $state(false)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  function wake() {
    idle = false
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => (idle = true), 3000)
  }
  $effect(() => {
    if (loop || !playing) return
    wake()
    window.addEventListener('pointermove', wake, { passive: true })
    window.addEventListener('keydown', wake, true)
    return () => {
      clearTimeout(idleTimer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake, true)
      idle = false
    }
  })

  function fail() {
    if (dead) return
    dead = true
    clearInterval(poll)
    settle(false)
    onended?.(false)
  }
  function command(target: HTMLIFrameElement | undefined, source: YoutubeEmbedSource | undefined, func: string, args: unknown[] = []) {
    const player = target?.contentWindow
    if (!player || !source) return
    const payload = JSON.stringify({ event: 'command', func, args })
    if (source.bridgeOrigin) {
      player.postMessage({ type: 'izumi-youtube-command', payload }, source.bridgeOrigin)
    } else {
      player.postMessage(payload, 'https://www.youtube-nocookie.com')
    }
  }
  function send(func: string, args: unknown[] = []) {
    command(frame, embed, func, args)
  }

  // The player: the parked one when there is one (the video swapped in, see youtube-pool), else a new
  // iframe. Players made through a loopback bridge only serve the same bridge.
  const poolKey = (source: YoutubeEmbedSource) => source.bridgeOrigin ?? 'direct'
  // The player in the box and the embed it was set up for, plain so the outro reads it after `embed` resets.
  let attached: { el: HTMLIFrameElement; source: YoutubeEmbedSource } | undefined
  $effect(() => {
    const source = embed
    const box = host
    if (!source || !box) return
    const el = untrack(() => {
      const reused = takePlayer(poolKey(source), box)
      if (reused) {
        command(reused, source, 'loadVideoById', [id])
        return reused
      }
      const created = document.createElement('iframe')
      created.title = 'Trailer'
      created.allow = 'autoplay'
      created.referrerPolicy = 'strict-origin-when-cross-origin'
      created.onload = () => { clearInterval(poll); handshake(); poll = setInterval(handshake, 100) }
      created.src = source.src
      box.append(created)
      return created
    })
    frame = el
    attached = { el, source }
    return () => {
      clearInterval(poll)
      frame = undefined
      if (attached?.el === el) attached = undefined
      // Still in its box: not parked on the way out (a failed player, or no `moveBefore`).
      if (el.parentElement === box) el.remove()
    }
  })
  // Svelte takes a block's DOM away before the teardowns inside it run, so the outro (a no-op one) is
  // where the live player can still be moved out: stopped, muted, parked for the next trailer.
  function parkOnExit(node: HTMLElement) {
    const current = attached
    if (current && !dead && node.contains(current.el)) {
      command(current.el, current.source, 'stopVideo')
      command(current.el, current.source, 'mute')
      parkPlayer(current.el, poolKey(current.source))
    }
    return { duration: 0 }
  }
  const frameClass = $derived(`pointer-events-none absolute ${fit === 'cover' ? 'left-1/2 top-1/2 -translate-x-1/2' : 'left-0 top-1/2 h-[calc(100%+200px)] w-full'} -translate-y-1/2 border-0 transition-opacity ${fading ? 'duration-500' : 'duration-0'} ${shown ? 'opacity-100' : 'opacity-0'}`)
  $effect(() => {
    if (!frame) return
    frame.className = frameClass
    frame.style.cssText = fit === 'cover' ? COVER_STYLE : ''
  })
  function toggleMute() {
    // M is swallowed before the idle listener hears it, so show the button it just changed.
    if (!loop) wake()
    $trailerMuted = !$trailerMuted
    // Keep the command inside the click/keypress user gesture. This matters to autoplay policies
    // that reject an asynchronous attempt to add audio to an already-autoplaying video.
    if (playing) send($trailerMuted ? 'mute' : 'unMute')
  }
  function onKey(e: KeyboardEvent) {
    if (activeKeyboardTrailers[activeKeyboardTrailers.length - 1] !== keyboardOwner) return
    // Under the full trailer player or dialog, M and the other keys are theirs.
    if ($trailerPopup) return
    // A backdrop trailer offers M and T only while its mute button is on screen.
    if (!loop && !playing) return
    const key = e.key.toLowerCase()
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || (key !== 'm' && key !== 't')) return
    // T is specifically a playing-preview affordance; while the iframe is still loading there is
    // no active trailer for the user to promote into the full dialog.
    if (key === 't' && !playing) return
    const target = e.target
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (key === 'm') toggleMute()
    else {
      // Avoid a brief double-audio overlap while pointerleave fades this preview out underneath
      // the newly mounted full dialog.
      send('mute')
      openTrailerPopup(id, title)
    }
  }
  function onMessage(e: MessageEvent) {
    if (e.source !== frame?.contentWindow || !embed) return
    let payload: unknown
    if (embed.bridgeOrigin) {
      if (e.origin !== embed.bridgeOrigin || e.data?.type !== 'izumi-youtube-event') return
      payload = e.data.payload
    } else {
      if (!youtubePlayerOrigins.has(e.origin)) return
      payload = e.data
    }
    if (typeof payload !== 'string') return
    let json: { event?: string; info?: number | { playerState?: number; currentTime?: number; duration?: number; videoData?: { isPlayable?: boolean } } }
    try { json = JSON.parse(payload) } catch { return }
    const info = typeof json.info === 'object' ? json.info : undefined
    const state = json.event === 'infoDelivery' || json.event === 'initialDelivery' ? info?.playerState : undefined
    if (json.event === 'onReady') { send('setVolume', [30]); clearInterval(poll) }
    if (json.event === 'onError') fail()
    if (json.event === 'initialDelivery' && info?.videoData?.isPlayable === false) fail()
    // YouTube turns a caption track on by itself (no embed parameter stops it) and loads the captions
    // module again on later API changes, so it is unloaded each time.
    if (json.event === 'apiInfoDelivery' || state === 1) send('unloadModule', ['captions'])
    if (typeof state === 'number') settle(state === 1)
    if (info?.duration) duration = info.duration
    // The reported duration is rounded up to the second and the time arrives every ~0.3 s: 2 s of margin.
    if (shown && duration && (info?.currentTime ?? 0) >= duration - 2) { fading = true; shown = false }
    // ENDED (0), the picture already faded out: restart from the top instead of showing YouTube's end
    // screen, or, playing once, report the end.
    if (json.event === 'infoDelivery' && info?.playerState === 0) {
      if (loop) { send('seekTo', [0, true]); send('playVideo') } else if (!ended) { ended = true; playing = false; onended?.(true) }
    }
  }
  function handshake() {
    const target = frame?.contentWindow
    if (!target || !embed) return
    const payload = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' })
    if (embed.bridgeOrigin) {
      target.postMessage({ type: 'izumi-youtube-command', payload }, embed.bridgeOrigin)
    } else {
      target.postMessage(payload, 'https://www.youtube-nocookie.com')
    }
  }
  onMount(() => {
    // Only the hover previews loop; while one is mounted the backdrop trailers hold (BackdropTrailer).
    const hover = loop
    if (hover) hoverTrailers.update((n) => n + 1)
    activeKeyboardTrailers.push(keyboardOwner)
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey, true)
    return () => {
      if (hover) hoverTrailers.update((n) => n - 1)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey, true)
      const at = activeKeyboardTrailers.indexOf(keyboardOwner)
      if (at >= 0) activeKeyboardTrailers.splice(at, 1)
      clearInterval(poll)
      clearTimeout(revealTimer)
    }
  })
</script>

{#snippet player()}
  <!-- The iframe is placed here by script (a new one, or the parked player moved in). -->
  <div bind:this={host} class="contents" out:parkOnExit|global></div>
{/snippet}

{#if !dead && embed}
  {#if fit === 'cover'}
    <!-- Size containment makes a stacking context, so it wraps the picture only: the mute button
         stays outside it, where its z-index can lift it over the host's copy and scrims. -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden [container-type:size]">{@render player()}</div>
  {:else}
    {@render player()}
  {/if}
  {#if playing}
    <button
      data-part={mutePart}
      data-idle={(idle && !focusVisible) || undefined}
      onclick={(e) => { e.stopPropagation(); toggleMute() }}
      onfocus={(e) => (focusVisible = e.currentTarget.matches(':focus-visible'))}
      onblur={() => (focusVisible = false)}
      class="pointer-events-auto absolute {muteClass} rounded-md bg-black/50 p-1 text-white transition-opacity duration-300 {idle && !focusVisible ? 'opacity-0' : ''}"
      aria-label={$trailerMuted ? 'Unmute' : 'Mute'}
    >
      {#if $trailerMuted}<VolumeX size={14} />{:else}<Volume2 size={14} />{/if}
    </button>
  {/if}
{/if}
