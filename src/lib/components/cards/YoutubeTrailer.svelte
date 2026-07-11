<script lang="ts">
  // Muted autoplay YouTube trailer for the hover preview. Uses the youtube-nocookie
  // embed + the JS-API postMessage handshake: poll "listening" until the player
  // answers, fade the iframe in once it reports PLAYING, and hide (fall back to the
  // still banner behind it) if the video isn't embeddable/region-locked.
  // Works on Chromium webviews (WebView2); Linux/WebKitGTK falls back to still image
  // (guarded by the caller) since it lacks `credentialless`.
  import { onMount } from 'svelte'
  import VolumeX from 'lucide-svelte/icons/volume-x'
  import Volume2 from 'lucide-svelte/icons/volume-2'
  import { trailerMuted } from '$lib/stores/trailer'
  let { id }: { id: string } = $props()

  let frame = $state<HTMLIFrameElement>()
  let playing = $state(false)
  let dead = $state(false)
  let poll: ReturnType<typeof setInterval> | undefined

  // Apply the session-wide mute state to THIS trailer whenever it (or the shared
  // state) changes — so unmuting one card carries to every trailer you hover next.
  $effect(() => {
    if (playing) send($trailerMuted ? 'mute' : 'unMute')
  })

  // No `loop=1&playlist=` — that param injects the prev/next skip buttons. We
  // loop manually via the JS API on the ENDED event instead (see onMessage).
  const src = $derived(`https://www.youtube-nocookie.com/embed/${id}` +
    `?enablejsapi=1&autoplay=1&controls=0&mute=1&disablekb=1` +
    `&cc_lang_pref=ja&iv_load_policy=3&modestbranding=1&playsinline=1`)

  function send(func: string, args: unknown[] = []) {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
  }
  function onMessage(e: MessageEvent) {
    if (typeof e.data !== 'string' || !e.origin.includes('youtube')) return
    let json: { event?: string; info?: { playerState?: number; videoData?: { isPlayable?: boolean } } }
    try { json = JSON.parse(e.data) } catch { return }
    if (json.event === 'onReady') { send('setVolume', [30]); clearInterval(poll) }
    if (json.event === 'initialDelivery' && json.info?.videoData?.isPlayable === false) dead = true
    if (json.event === 'infoDelivery' && json.info?.playerState === 1) playing = true
    // ENDED (0): restart from the top instead of showing YouTube's end screen.
    if (json.event === 'infoDelivery' && json.info?.playerState === 0) { send('seekTo', [0, true]); send('playVideo') }
  }
  function handshake() {
    frame?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
  }
  onMount(() => {
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage); clearInterval(poll) }
  })
</script>

{#if !dead}
  <iframe
    bind:this={frame}
    title="Trailer"
    onload={() => (poll = setInterval(handshake, 100))}
    allow="autoplay"
    {...{ credentialless: true } as Record<string, unknown>}
    {src}
    class="pointer-events-none absolute left-0 top-1/2 h-[calc(100%+200px)] w-full -translate-y-1/2 border-0 transition-opacity duration-500 {playing ? 'opacity-100' : 'opacity-0'}"
  ></iframe>
  {#if playing}
    <button
      onclick={(e) => { e.stopPropagation(); $trailerMuted = !$trailerMuted }}
      class="pointer-events-auto absolute right-1 top-1 z-10 rounded-md bg-black/50 p-1 text-white"
      aria-label={$trailerMuted ? 'Unmute' : 'Mute'}
    >
      {#if $trailerMuted}<VolumeX size={14} />{:else}<Volume2 size={14} />{/if}
    </button>
  {/if}
{/if}
