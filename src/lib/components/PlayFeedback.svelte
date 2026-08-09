<script lang="ts">
  // The stand-in shown between a Play/episode tap and the real player-flow overlay being ready.
  //
  // It exists because those overlays are lazily imported and their graph carries lottie-web (~300KB),
  // so on a cold HTTP cache the gate opens and the chunk is still on the network. Everything here is
  // therefore deliberately cheap and EAGERLY bundled: no lottie, no images, no store subscriptions,
  // no imports at all. If this file ever grows an import, check first that it does not drag the very
  // chunk it is covering for into the boot bundle.
  //
  // The markup deliberately MIRRORS SourceLoader's game-mode branch (same backdrop, same title, same
  // ring in the same 28x52 slot, same tracked caption). It used to be a bare ring on a grey scrim,
  // which on the Deck — where the chunk is slowest, so this holds the screen longest — read as a
  // cheap loading blip before the real connecting screen. Matching the two makes the handover
  // invisible instead: the same screen simply gains its animation once the chunk lands.
  let { label, caption = 'Connecting', art = '' }: {
    label: string
    caption?: string
    // Passed in rather than read from the session store, so this stays import-free.
    art?: string
  } = $props()
</script>

<!-- Same z-index band and same opaque black as the overlays it precedes, so nothing renders on top
     of it and the real screen replaces this in place with no brightness pop. -->
<div class="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black px-8" role="status" aria-live="polite">
  {#if art}
    <!-- Desktop blurs this still; game mode's `loading-backdrop` rule drops the filter, because
         animating over a full-screen filtered layer makes Deck WebKit repaint it every frame. -->
    <img src={art} alt="" class="loading-backdrop pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />
  {/if}
  <div class="relative flex w-full max-w-xl flex-col items-center gap-6 px-6 text-center">
    {#if label}
      <h1 class="text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:text-4xl">{label}</h1>
    {/if}
    <div class="grid h-28 w-52 place-items-center" aria-hidden="true">
      <!-- `loading-spinner` is what app.css steps down to 8 discrete turns/second in game mode. -->
      <div class="loading-spinner size-14 animate-spin rounded-full border-4 border-white/20 border-t-white"></div>
    </div>
    <p class="text-xs font-bold uppercase tracking-[0.36em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{caption}</p>
  </div>
</div>
