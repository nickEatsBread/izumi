<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title } from '$lib/anilist/media'
  let { medias, onplay }: { medias: Media[]; onplay?: (m: Media) => void } = $props()

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
</script>

{#if current}
  <div class="relative mb-6 h-[42vh] w-full overflow-hidden transition-opacity duration-300 {scrolled ? 'opacity-40' : 'opacity-100'}">
    {#key current.id}
      <img src={banner(current)} alt="" class="absolute inset-0 h-full w-full animate-[fade_0.6s_ease] object-cover" />
    {/key}
    <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>

    <div class="absolute bottom-6 left-8 max-w-xl">
      <h1 class="text-3xl font-black drop-shadow">{title(current)}</h1>
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
