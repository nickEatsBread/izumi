<script lang="ts">
  // The connecting screen, mounted app-wide rather than inside the source picker.
  //
  // It used to live in the picker, which meant it only existed when the picker did — so Continue
  // Watching and binge continuation, which both resolve with the picker closed, fell straight
  // through to the debrid caching screen even when debrid was not what they were waiting on. This
  // covers every route into playback, and the caching screen is left to mean what it says.
  import { connecting, debridCaching } from '$lib/player/session'
  import SourceLoader from './SourceLoader.svelte'
  import { fade } from 'svelte/transition'

  const c = $derived($connecting)
  const backdrop = $derived(c?.art ?? '')
</script>

<!-- Yields to the caching screen: once that is up, debrid genuinely is the wait, and two
     full-screen overlays would fight over the same z-order. -->
{#if c && !$debridCaching}
  <div class="fixed inset-0 z-[55] grid place-items-center overflow-hidden bg-black/85" transition:fade={{ duration: 160 }}>
    {#if backdrop}
      <!-- `filter` on a STATIC image, never `backdrop-filter`: the latter re-samples live content
           every frame, which is what wedged Deck WebKit. -->
      <img src={backdrop} alt="" class="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />
    {/if}
    <div class="relative">
      <SourceLoader title={c.title} caption="Connecting" detail={c.detail} onCancel={c.cancel} />
    </div>
  </div>
{/if}
