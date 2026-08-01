<script lang="ts">
  // The connecting screen, mounted app-wide rather than inside the source picker.
  //
  // It used to live in the picker, which meant it only existed when the picker did — so Continue
  // Watching and binge continuation, which both resolve with the picker closed, fell straight
  // through to the debrid caching screen even when debrid was not what they were waiting on. This
  // covers every route into playback, and the caching screen is left to mean what it says.
  import { connecting, debridCaching, gameMode } from '$lib/player/session'
  import SourceLoader from './SourceLoader.svelte'
  import { fade } from 'svelte/transition'

  const c = $derived($connecting)
  const backdrop = $derived(c?.art ?? '')
</script>

<!-- Yields to the caching screen: once that is up, debrid genuinely is the wait, and two
     full-screen overlays would fight over the same z-order. -->
{#if c && !$debridCaching}
  <div
    class="fixed inset-0 z-[55] grid place-items-center overflow-hidden bg-black"
    onclick={() => c?.cancel()}
    onkeydown={(e) => e.key === 'Escape' && c?.cancel()}
    role="presentation"
    transition:fade={{ duration: $gameMode ? 0 : 160 }}
  >
    {#if backdrop}
      <!-- Desktop blurs this static image. Game mode's loading-backdrop rule removes the filter:
           animating over a full-screen filtered layer makes Deck WebKit repaint it every frame. -->
      <img src={backdrop} alt="" class="loading-backdrop pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />
    {/if}
    <button data-focusable onclick={(e) => { e.stopPropagation(); c?.cancel() }} class="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white" aria-label="Close">✕</button>
    <div class="relative" onclick={(e) => e.stopPropagation()} role="presentation">
      <SourceLoader title={c.title} caption="Connecting" detail={c.detail} onCancel={c.cancel} />
    </div>
  </div>
{/if}
