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
  let { id, title = 'Trailer' }: { id: string; title?: string } = $props()

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
      .catch(() => { if (!cancelled) dead = true })
    return () => { cancelled = true }
  })

  // Apply the session-wide mute state to THIS trailer whenever it (or the shared
  // state) changes — so unmuting one card carries to every trailer you hover next.
  $effect(() => {
    if (playing) send($trailerMuted ? 'mute' : 'unMute')
  })

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
    if (json.event === 'onError') { dead = true; clearInterval(poll) }
    if (json.event === 'initialDelivery' && info?.videoData?.isPlayable === false) dead = true
    if (json.event === 'infoDelivery' && info?.playerState === 1) playing = true
    // ENDED (0): restart from the top instead of showing YouTube's end screen.
    if (json.event === 'infoDelivery' && info?.playerState === 0) { send('seekTo', [0, true]); send('playVideo') }
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
    class="pointer-events-none absolute left-0 top-1/2 h-[calc(100%+200px)] w-full -translate-y-1/2 border-0 transition-opacity duration-500 {playing ? 'opacity-100' : 'opacity-0'}"
  ></iframe>
  {#if playing}
    <button
      onclick={(e) => { e.stopPropagation(); toggleMute() }}
      class="pointer-events-auto absolute right-1 top-1 z-10 rounded-md bg-black/50 p-1 text-white"
      aria-label={$trailerMuted ? 'Unmute' : 'Mute'}
    >
      {#if $trailerMuted}<VolumeX size={14} />{:else}<Volume2 size={14} />{/if}
    </button>
  {/if}
{/if}
