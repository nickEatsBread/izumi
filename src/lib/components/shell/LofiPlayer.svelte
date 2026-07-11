<script lang="ts">
  import { onMount } from 'svelte'
  import { playing } from '$lib/player/session'
  import { lofiTrack, lofiUrl, nextTrack, prevTrack } from '$lib/stores/lofi'
  import Volume2 from 'lucide-svelte/icons/volume-2'
  import VolumeX from 'lucide-svelte/icons/volume-x'

  // Lo-fi background music. OFF by default and never auto-plays (the browser's
  // autoplay policy blocks sound without a gesture anyway) — the user clicks the
  // speaker to start. `on` is local, deliberately not persisted. The selected
  // track IS persisted via lofiTrack.
  let on = $state(false)
  let audio = $state<HTMLAudioElement>()

  // Swap the <audio> source when the track changes; keep playing if we're on.
  $effect(() => {
    const url = lofiUrl($lofiTrack)
    if (audio && audio.src !== url) {
      audio.src = url
      if (on) audio.play().catch(() => {})
    }
  })

  // A video takes over audio — stop the music. Does NOT auto-resume afterwards.
  $effect(() => {
    if ($playing && on) { on = false; audio?.pause() }
  })

  function toggle() {
    on = !on
    if (on) audio?.play().catch(() => {})
    else audio?.pause()
  }

  // [ / ] step tracks while on. Ignored while typing in a field.
  function onKey(e: KeyboardEvent) {
    if (!on) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === '[') { e.preventDefault(); $lofiTrack = prevTrack($lofiTrack) }
    else if (e.key === ']') { e.preventDefault(); $lofiTrack = nextTrack($lofiTrack) }
  }

  onMount(() => {
    if (audio) audio.volume = 0.5
    window.addEventListener('keydown', onKey)
    // Pause on teardown: when a video starts, the parent {#if} unmounts this whole
    // component, and removing the <audio> from the DOM does NOT stop playback — so
    // explicitly pause here to honour "music stops when a video plays".
    return () => { window.removeEventListener('keydown', onKey); audio?.pause() }
  })
</script>

<audio bind:this={audio} loop preload="none"></audio>

<div class="fixed left-16 top-0 z-50 flex h-8 items-center">
  {#if on}
    <div class="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
      <button data-focusable onclick={toggle} aria-label="Turn lo-fi off" class="grid place-items-center text-theme">
        <Volume2 size={16} />
      </button>
      <span class="font-bold">Lo-Fi</span>
      <span class="tabular-nums text-muted-foreground">{$lofiTrack + 1} / 4</span>
      <span class="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
        <kbd class="rounded border border-border bg-background px-1 font-mono">[</kbd>
        <kbd class="rounded border border-border bg-background px-1 font-mono">]</kbd>
        switch
      </span>
    </div>
  {:else}
    <button data-focusable onclick={toggle} aria-label="Turn lo-fi on"
      class="grid h-7 w-7 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:text-foreground">
      <VolumeX size={16} />
    </button>
  {/if}
</div>
