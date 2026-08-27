<script lang="ts">
  // The stand-in shown between a Play/episode tap and the real player-flow overlay being ready.
  //
  // It exists because those overlays are lazily imported with the player stack,
  // so on a cold HTTP cache the gate opens and the chunk is still on the network. Everything here is
  // therefore deliberately cheap and EAGERLY bundled: no animation library, images, or stores,
  // no imports at all. If this file ever grows an import, check first that it does not drag the very
  // chunk it is covering for into the boot bundle.
  //
  // The markup deliberately MIRRORS SourceLoader (same backdrop, same title, same bar in the same
  // 28x52 slot, same tracked caption). It used to show a circular ring here, which read as "the
  // wrong loader" whenever this stand-in held the screen — on a cold chunk cache it IS the source
  // loader for a second or two. The CSS `bar-loader` matches the source bar's motion, so the real
  // screen replaces this in place and simply refines the animation once the chunk lands.
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
      <div class="bar-loader h-1 w-40 rounded-full bg-white/20"></div>
    </div>
    <p class="text-xs font-bold uppercase tracking-[0.36em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{caption}</p>
  </div>
</div>
