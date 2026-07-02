<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { title } from '$lib/anilist/media'
  let {
    medias,
    onplay,
    onchange,
  }: { medias: Media[]; onplay?: (m: Media) => void; onchange?: (m: Media) => void } = $props()

  let i = $state(0)
  let progress = $state(0)
  let scrolled = $state(false)
  let start: number | null = null
  const DURATION = 8000

  function go(n: number) { i = n; progress = 0; start = null }

  $effect(() => {
    const n = medias.length
    if (!n) return
    let raf = 0
    const tick = (t: number) => {
      if (start == null) start = t
      progress = Math.min(1, (t - start) / DURATION)
      if (progress >= 1) { i = (i + 1) % n; start = t; progress = 0 }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onScroll = () => scrolled = (window.scrollY ?? 0) > 100
    window.addEventListener('scroll', onScroll)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll) }
  })

  const current = $derived(medias[Math.min(i, Math.max(0, medias.length - 1))])

  // Publish the current slide to the parent (which pushes it into the shared
  // banner via the heroMedia store). The banner image itself now lives in the
  // global BannerBg layer, so this component only renders the overlay.
  $effect(() => { if (current) onchange?.(current) })
</script>

{#if current}
  <div class="relative mb-6 flex h-[42vh] w-full flex-col justify-end px-8 pb-6 transition-opacity duration-300 {scrolled ? 'opacity-40' : 'opacity-100'}">
    <div class="max-w-xl">
      <h1 class="text-3xl font-black drop-shadow-lg">{title(current)}</h1>
      <div class="mt-3 flex gap-2">
        <button data-focusable onclick={() => onplay?.(current)} class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Play</button>
        <button data-focusable onclick={() => onplay?.(current)} class="rounded-md bg-secondary px-4 py-2 font-bold">Info</button>
      </div>
    </div>

    {#if medias.length > 1}
      <div class="absolute bottom-6 right-8 flex gap-1.5">
        {#each medias as _, idx}
          <button data-focusable onclick={() => go(idx)} aria-label={`Slide ${idx + 1}`}
                  class="h-1 w-8 overflow-hidden rounded-full bg-white/25">
            <div class="h-full bg-white" style={`width:${idx < i ? 100 : idx === i ? progress * 100 : 0}%`}></div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
