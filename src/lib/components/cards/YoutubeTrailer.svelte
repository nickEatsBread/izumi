<script lang="ts">
  // Muted autoplay YouTube trailer for the hover preview. Uses the youtube-nocookie
  // embed + the JS-API postMessage handshake: poll "listening" until the player
  // answers, fade the iframe in once it reports PLAYING, and hide (fall back to the
  // still banner behind it) if the video isn't embeddable/region-locked.
  // Works on Chromium webviews (WebView2); Linux/WebKitGTK falls back to still image
  // (guarded by the caller) since it lacks `credentialless`.
  import { onMount } from 'svelte'
  let { id }: { id: string } = $props()

  let frame: HTMLIFrameElement
  let playing = $state(false)
  let dead = $state(false)
  let poll: ReturnType<typeof setInterval> | undefined

  const src = `https://www.youtube-nocookie.com/embed/${id}` +
    `?enablejsapi=1&autoplay=1&controls=0&mute=1&disablekb=1&loop=1&playlist=${id}` +
    `&cc_lang_pref=ja&iv_load_policy=3&modestbranding=1&playsinline=1`

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
    credentialless
    {src}
    class="pointer-events-none absolute left-0 top-1/2 h-[calc(100%+200px)] w-full -translate-y-1/2 border-0 transition-opacity duration-500 {playing ? 'opacity-100' : 'opacity-0'}"
  ></iframe>
{/if}
