<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title } from '$lib/anilist/media'
  let {
    medias,
    onplay,
    showOverlay = true,
  }: { medias: Media[]; onplay?: (m: Media) => void; showOverlay?: boolean } = $props()

  let i = $state(0)
  let progress = $state(0)
  let scrolled = $state(false)
  let start: number | null = null
  const DURATION = 8000

  function go(n: number) { i = n; progress = 0; start = null }

  // Rotate + track scroll only when there's an overlay (Home). Detail passes one
  // media with showOverlay=false (banner backdrop only).
  $effect(() => {
    const n = medias.length
    if (!n || !showOverlay) return
    let raf = 0
    const tick = (t: number) => {
      if (start == null) start = t
      progress = Math.min(1, (t - start) / DURATION)
      if (progress >= 1) { i = (i + 1) % n; start = t; progress = 0 }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onScroll = () => (scrolled = (window.scrollY ?? 0) > 100)
    window.addEventListener('scroll', onScroll)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll) }
  })

  const current = $derived(medias[Math.min(i, Math.max(0, medias.length - 1))])
</script>

{#if current}
  <div class="relative mb-6 h-[55vh] transition-opacity duration-300 {scrolled ? 'opacity-40' : 'opacity-100'}">
    <!-- Full-bleed banner: breaks out of main's left margin (behind the translucent
         sidebar) and up under the frameless titlebar. -->
    <div class="absolute -left-14 -top-8 h-[calc(100%+2rem)] w-screen overflow-hidden">
      {#key current.id}
        <img src={banner(current)} alt="" class="absolute inset-0 h-full w-full animate-[fade_0.6s_ease] object-cover" style="object-position:center 20%" />
      {/key}
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
      <div class="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-background/60 to-transparent"></div>
    </div>

    {#if showOverlay}
      <div class="absolute inset-x-0 bottom-0 px-8 pb-6">
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
  </div>
{/if}
