<script lang="ts">
  // The connecting screen, mounted app-wide rather than inside the source picker.
  //
  // It used to live in the picker, which meant it only existed when the picker did — so Continue
  // Watching and binge continuation, which both resolve with the picker closed, fell straight
  // through to the debrid caching screen even when debrid was not what they were waiting on. This
  // covers every route into playback, and the caching screen is left to mean what it says.
  import { connecting, debridCaching, gameMode, playing, streamPicker } from '$lib/player/session'
  import SourceLoader from './SourceLoader.svelte'
  import AndroidConnectionStatus from './AndroidConnectionStatus.svelte'
  import AndroidPreparingPlayer from './AndroidPreparingPlayer.svelte'
  import { fade } from 'svelte/transition'
  import { isAndroid } from '$lib/platform'

  const c = $derived($connecting)
  const backdrop = $derived(c?.art ?? '')
</script>

<!-- Yields to the caching screen: once that is up, debrid genuinely is the wait, and two
     full-screen overlays would fight over the same z-order. -->
{#if c && !$debridCaching}
  {#if $isAndroid}
    <!-- A visible instant-auto picker already owns this exact preparation page. Hidden continuation
         pickers render nothing, so SourceConnecting must keep owning it for resume/next-episode. -->
    {#if c.media && (!$streamPicker || $streamPicker.hidden)}
      <AndroidPreparingPlayer media={c.media} episode={c.episode} />
    {/if}
    <div transition:fade={{ duration: 100 }}>
      <AndroidConnectionStatus headline="Getting episode ready" detail={c.detail || c.title} oncancel={() => c?.cancel()} />
    </div>
  {:else if $gameMode && $playing}
  <!-- A mid-playback source swap must not replace the current frame with a black loading page.
       This translucent, compact surface is snapshotted into mpv with the picker/player chrome. -->
  <div
    class="fixed inset-0 z-[55] grid place-items-center bg-black/45"
    onclick={() => c?.cancel()}
    onkeydown={(e) => e.key === 'Escape' && c?.cancel()}
    role="presentation"
  >
    <div class="relative w-full max-w-xl rounded-2xl border border-white/10 bg-black/80 py-6 shadow-2xl" onclick={(e) => e.stopPropagation()} role="presentation">
      <SourceLoader title={c.title} caption="Switching source" detail={c.detail} onCancel={c.cancel} />
    </div>
  </div>
  {:else}
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
{/if}
