<script lang="ts">
  import { trailerPopup, closeTrailerPopup } from '$lib/stores/trailer'

  let dialog = $state<HTMLDivElement>()
  $effect(() => {
    if (!$trailerPopup) return
    requestAnimationFrame(() => dialog?.focus({ preventScroll: true }))
  })
</script>

<svelte:window onkeydown={(e) => { if ($trailerPopup && e.key === 'Escape') closeTrailerPopup() }} />

{#if $trailerPopup}
  <div bind:this={dialog} data-nav-trap role="dialog" aria-modal="true"
       aria-label={`${$trailerPopup.title} trailer`} tabindex="-1"
       class="fixed inset-0 z-[80] grid place-items-center bg-black/80 sm:p-4"
       onclick={(e) => { if (e.target === e.currentTarget) closeTrailerPopup() }}
       onkeydown={(e) => { if (e.key === 'Escape') closeTrailerPopup() }}
       onwheel={(e) => e.preventDefault()}>
    <div class="aspect-video w-full max-w-4xl sm:px-0">
      {#key $trailerPopup.id}
        <iframe class="h-full w-full rounded-lg" title={`${$trailerPopup.title} trailer`}
                src={`https://www.youtube-nocookie.com/embed/${$trailerPopup.id}?autoplay=1`}
                allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>
      {/key}
    </div>
    <button data-focusable onclick={closeTrailerPopup}
            class="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-md bg-secondary px-3 py-2 text-sm font-bold">
      Close
    </button>
  </div>
{/if}
