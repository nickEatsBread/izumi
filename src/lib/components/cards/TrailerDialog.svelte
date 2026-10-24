<script lang="ts">
  import { trailerPopup, closeTrailerPopup } from '$lib/stores/trailer'
  import { youtubeEmbedSource, type YoutubeEmbedSource } from './youtube-embed'
  import { navLayer } from '$lib/nav/overlay'

  // The popup only; a `player` trailer opens in TrailerPlayer instead.
  const open = $derived($trailerPopup?.mode === 'popup' ? $trailerPopup : null)
  let dialog = $state<HTMLDialogElement>()
  let embed = $state<YoutubeEmbedSource>()
  let embedFailed = $state(false)
  $effect(() => {
    if (!open || !dialog) return
    const element = dialog
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  })
  $effect(() => {
    const popup = open
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

{#if open}
  <!-- Also a nav layer, so B and the TV remote's Back close it: their Escape is dispatched on window
       and never reaches the native cancel. Keyboard Escape meets the layer capture first; oncancel
       stays as the fallback. The effect above restores focus, so the layer does not. -->
  <dialog bind:this={dialog} data-nav-trap data-nav-escape aria-modal="true"
       use:navLayer={{ kind: 'trailer', onClose: () => closeTrailerPopup(), returnFocus: 'none' }}
       aria-label={`${open.title} trailer`} tabindex="-1"
       class="fixed inset-0 z-[80] m-0 grid h-full max-h-none w-full max-w-none place-items-center bg-black/80 p-0 sm:p-4"
       onclick={(e) => { if (e.target === e.currentTarget) closeTrailerPopup() }}
       oncancel={(e) => { e.preventDefault(); closeTrailerPopup() }}
       onwheel={(e) => e.preventDefault()}>
    <div class="aspect-video w-full max-w-4xl sm:px-0">
      {#key open.id}
        {#if embed}
          <iframe class="h-full w-full rounded-lg" title={`${open.title} trailer`}
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
            class="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] min-h-11 rounded-md bg-secondary px-3 py-2 text-sm font-bold">
      Close
    </button>
  </dialog>
{/if}
