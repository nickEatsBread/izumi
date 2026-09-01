<script lang="ts">
  import { trailerPopup, closeTrailerPopup } from '$lib/stores/trailer'
  import { youtubeEmbedSource, type YoutubeEmbedSource } from './youtube-embed'

  let dialog = $state<HTMLDivElement>()
  let embed = $state<YoutubeEmbedSource>()
  let embedFailed = $state(false)
  $effect(() => {
    if (!$trailerPopup) return
    requestAnimationFrame(() => dialog?.focus({ preventScroll: true }))
  })
  $effect(() => {
    const popup = $trailerPopup
    embed = undefined
    embedFailed = false
    if (!popup) return
    let cancelled = false
    void youtubeEmbedSource(popup.id, { controls: true, muted: false })
      .then((source) => { if (!cancelled) embed = source })
      .catch(() => { if (!cancelled) embedFailed = true })
    return () => { cancelled = true }
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
        {#if embed}
          <iframe class="h-full w-full rounded-lg" title={`${$trailerPopup.title} trailer`}
                  src={embed.src} referrerpolicy="strict-origin-when-cross-origin"
                  allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>
        {:else if embedFailed}
          <div class="grid h-full w-full place-items-center rounded-lg bg-black text-sm text-white/70"
               role="status">Trailer unavailable</div>
        {:else}
          <div class="h-full w-full rounded-lg bg-black" aria-label="Loading trailer"></div>
        {/if}
      {/key}
    </div>
    <button data-focusable onclick={closeTrailerPopup}
            class="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-md bg-secondary px-3 py-2 text-sm font-bold">
      Close
    </button>
  </div>
{/if}
