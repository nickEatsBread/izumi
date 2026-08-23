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
  import { isAndroid } from '$lib/platform'

  const c = $derived($connecting)
  const backdrop = $derived(c?.art ?? '')
</script>

<!-- Yields to the caching screen: once that is up, debrid genuinely is the wait, and two
     full-screen overlays would fight over the same z-order. -->
{#if c && !$debridCaching}
  {#if $isAndroid}
    <!-- Keep the watch page visible on phones. This slim loader sits against the lower edge of the
         portrait 16:9 video instead of replacing the entire app with a connecting screen. -->
    <div class="android-connect fixed inset-x-4 z-[55] overflow-hidden rounded-full bg-black/85 shadow-xl"
         role="status" aria-live="polite" transition:fade={{ duration: 100 }}>
      <div class="bar-loader h-1.5 w-full"></div>
      <div class="flex items-center gap-2 px-3 py-2 text-xs text-white/80">
        <span class="min-w-0 flex-1 truncate">Connecting{c.detail ? ` · ${c.detail}` : ''}</span>
        <button data-focusable onclick={() => c?.cancel()} class="grid size-7 shrink-0 place-items-center rounded-full bg-white/10" aria-label="Cancel connecting">✕</button>
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

<style>
  .android-connect { top: calc(env(safe-area-inset-top) + 56.25vw - 0.375rem); }
  @media (orientation: landscape) {
    .android-connect { top: auto; bottom: calc(env(safe-area-inset-bottom) + 0.75rem); }
  }
</style>
