<script module lang="ts">
  // Fade-out and fade-in can briefly leave two preview components mounted. Only the most recently
  // mounted trailer owns the global M shortcut so one keypress can never toggle the shared state
  // twice and appear to do nothing.
  const activeKeyboardTrailers: symbol[] = []
</script>

<script lang="ts">
  // Muted autoplay YouTube trailer for the hover preview. Desktop WebViews with a non-HTTP app
  // origin use a loopback document so YouTube receives the HTTP embedder identity it requires.
  import { onMount } from 'svelte'
  import VolumeX from '@lucide/svelte/icons/volume-x'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import { trailerMuted, openTrailerPopup } from '$lib/stores/trailer'
  import {
    youtubeEmbedSource,
    youtubePlayerOrigins,
    type YoutubeEmbedSource,
  } from './youtube-embed'
  // The defaults are the hover preview; BackdropTrailer plays once (`loop: false`), covers its box and
  // listens for the start and the end (`natural` = the video reached its end, false = it failed).
  let { id, title = 'Trailer', loop = true, fit = 'crop', mutePart, muteClass = 'right-1 top-1 z-10', onplaying, onended }: {
    id: string; title?: string; loop?: boolean; fit?: 'crop' | 'cover'; mutePart?: string; muteClass?: string
    onplaying?: () => void; onended?: (natural: boolean) => void
  } = $props()
  // `cover` fills a size container (`container-type: size`) at 16:9; the extra 240 px letterboxes
  // YouTube's own title and branding above and below the picture, where the box's overflow cuts them.
  const COVER_STYLE = 'width:max(100cqw,calc(100cqh*16/9));height:calc(max(56.25cqw,100cqh) + 240px)'

  let frame = $state<HTMLIFrameElement>()
  let playing = $state(false)
  let dead = $state(false)
  let embed = $state<YoutubeEmbedSource>()
  let poll: ReturnType<typeof setInterval> | undefined
  const keyboardOwner = Symbol('hover-trailer')

  $effect(() => {
    const videoId = id
    let cancelled = false
    embed = undefined
    playing = false
    dead = false
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

  function fail() {
    if (dead) return
    dead = true
    clearInterval(poll)
    onended?.(false)
  }
  function send(func: string, args: unknown[] = []) {
    const target = frame?.contentWindow
    if (!target || !embed) return
    const payload = JSON.stringify({ event: 'command', func, args })
    if (embed.bridgeOrigin) {
      target.postMessage({ type: 'izumi-youtube-command', payload }, embed.bridgeOrigin)
    } else {
      target.postMessage(payload, 'https://www.youtube-nocookie.com')
    }
  }
  function toggleMute() {
    $trailerMuted = !$trailerMuted
    // Keep the command inside the click/keypress user gesture. This matters to autoplay policies
    // that reject an asynchronous attempt to add audio to an already-autoplaying video.
    if (playing) send($trailerMuted ? 'mute' : 'unMute')
  }
  function onKey(e: KeyboardEvent) {
    if (activeKeyboardTrailers[activeKeyboardTrailers.length - 1] !== keyboardOwner) return
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
    let json: { event?: string; info?: number | { playerState?: number; videoData?: { isPlayable?: boolean } } }
    try { json = JSON.parse(payload) } catch { return }
    const info = typeof json.info === 'object' ? json.info : undefined
    if (json.event === 'onReady') { send('setVolume', [30]); clearInterval(poll) }
    if (json.event === 'onError') fail()
    if (json.event === 'initialDelivery' && info?.videoData?.isPlayable === false) fail()
    if (json.event === 'infoDelivery' && info?.playerState === 1 && !playing) { playing = true; onplaying?.() }
    // ENDED (0): restart from the top instead of showing YouTube's end screen, or, playing once, fade
    // out (the iframe's opacity transition) before the end screen can show.
    if (json.event === 'infoDelivery' && info?.playerState === 0) {
      if (loop) { send('seekTo', [0, true]); send('playVideo') } else { playing = false; onended?.(true) }
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
    activeKeyboardTrailers.push(keyboardOwner)
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey, true)
      const at = activeKeyboardTrailers.indexOf(keyboardOwner)
      if (at >= 0) activeKeyboardTrailers.splice(at, 1)
      clearInterval(poll)
    }
  })
</script>

{#if !dead && embed}
  <iframe
    bind:this={frame}
    title="Trailer"
    onload={() => { clearInterval(poll); handshake(); poll = setInterval(handshake, 100) }}
    allow="autoplay"
    referrerpolicy="strict-origin-when-cross-origin"
    src={embed.src}
    class="pointer-events-none absolute {fit === 'cover' ? 'left-1/2 top-1/2 -translate-x-1/2' : 'left-0 top-1/2 h-[calc(100%+200px)] w-full'} -translate-y-1/2 border-0 transition-opacity duration-500 {playing ? 'opacity-100' : 'opacity-0'}"
    style={fit === 'cover' ? COVER_STYLE : undefined}
  ></iframe>
  {#if playing}
    <button
      data-part={mutePart}
      onclick={(e) => { e.stopPropagation(); toggleMute() }}
      class="pointer-events-auto absolute {muteClass} rounded-md bg-black/50 p-1 text-white"
      aria-label={$trailerMuted ? 'Unmute' : 'Mute'}
    >
      {#if $trailerMuted}<VolumeX size={14} />{:else}<Volume2 size={14} />{/if}
    </button>
  {/if}
{/if}
