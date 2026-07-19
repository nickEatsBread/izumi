<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title, format, status, season, totalEpisodes } from '$lib/anilist/media'
  import Play from 'lucide-svelte/icons/play'
  import Info from 'lucide-svelte/icons/info'
  import Heart from 'lucide-svelte/icons/heart'

  // Bottom-left content column + clean linear scrims, polished with:
  // coverImage.color accent, rating-tinted score, blur-in image, rich badge row,
  // genre pills, and a Watch/Details/Favorite trio. Detail pages pass one media
  // with showOverlay=false (backdrop only).
  let {
    medias,
    onplay,
    oninfo,
    onfav,
    showOverlay = true,
  }: {
    medias: Media[]
    onplay?: (m: Media) => void
    oninfo?: (m: Media) => void
    onfav?: (m: Media) => void
    showOverlay?: boolean
  } = $props()

  let i = $state(0)
  let progress = $state(0)
  let scrolled = $state(false)
  let start: number | null = null
  const DURATION = 15000 // a 15s cadence

  function go(n: number) { i = n; progress = 0; start = null }

  // rAF auto-advance + scroll fade, only when there's an overlay (Home).
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
    // Steam Deck: L1/R1 step through the featured banners (dispatched by the gamepad translator
    // while on the home screen). detail = -1 (prev) / +1 (next); wraps.
    const onHeroNav = (e: Event) => go((i + (e as CustomEvent<number>).detail + n) % n)
    window.addEventListener('hero-nav', onHeroNav)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hero-nav', onHeroNav)
    }
  })

  const current = $derived(medias[Math.min(i, Math.max(0, medias.length - 1))])
  // Accent: tint everything off the cover's dominant color; theme fallback.
  const accent = $derived(current?.coverImage?.color || 'hsl(346.6 79.12% 51.18%)')
  const scoreColor = (s?: number) =>
    s == null ? 'text-white/70' : s >= 75 ? 'text-green-400' : s >= 65 ? 'text-orange-400' : 'text-red-400'
  const cleanDesc = (d?: string) => (d ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
</script>

{#if current}
  <div
    class="relative mb-6 h-[42vh] touch-pan-y transition-opacity duration-500 sm:h-[55vh] {scrolled ? 'opacity-40' : 'opacity-100'}"
    style="--accent:{accent}"
  >
    <!-- Full-bleed banner: on desktop it breaks out of main's left margin (behind the
         sidebar) and up under the frameless titlebar. On mobile there's no sidebar/titlebar,
         so anchor it flush to the viewport edge (left-0/top-0) — the desktop -left-14 would
         otherwise leave a black band on the right. Keyed for a crossfade. -->
    <div class="pointer-events-none absolute left-0 top-0 h-[calc(100%+2rem)] w-screen overflow-hidden sm:-left-14 sm:-top-8">
      {#key current.id}
        <img src={banner(current)} alt="" draggable="false"
             class="absolute inset-0 h-full w-full animate-[heroIn_0.6s_ease] object-cover opacity-70"
             style="object-position:center 20%" />
      {/key}
      <!-- Dual linear scrims: bright top-right, dark bottom-left. -->
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
      <div class="absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-background/85 via-background/40 to-transparent"></div>
    </div>

    {#if showOverlay}
      <div class="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-8 sm:px-8">
        <div class="max-w-2xl">
          <h1 class="truncate text-2xl font-black text-white drop-shadow-[2px_2px_4px_rgba(0,0,0,.9)] sm:text-4xl">{title(current)}</h1>

          <!-- Metadata row: bullet-separators + format/status/season/score -->
          <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-white/90
                      [&>span:not(:first-child)]:before:mr-2 [&>span:not(:first-child)]:before:text-white/40 [&>span:not(:first-child)]:before:content-['•']">
            {#if format(current)}<span>{format(current)}</span>{/if}
            {#if totalEpisodes(current) > 1}<span>{totalEpisodes(current)} Episodes</span>{/if}
            {#if status(current)}<span>{status(current)}</span>{/if}
            {#if season(current)}<span>{season(current)}</span>{/if}
            {#if current.averageScore}<span class={scoreColor(current.averageScore)}>{current.averageScore}%</span>{/if}
          </div>

          {#if current.description}
            <p class="mt-3 line-clamp-3 max-w-xl text-sm text-white/70 drop-shadow">{cleanDesc(current.description)}</p>
          {/if}

          {#if current.genres?.length}
            <div class="mt-3 flex flex-wrap gap-2">
              {#each current.genres.slice(0, 4) as g}
                <span class="rounded-full bg-white/10 px-3 py-0.5 text-xs font-bold" style="color:var(--accent)">{g}</span>
              {/each}
            </div>
          {/if}

          <div class="mt-4 flex items-center gap-2">
            <button data-focusable onclick={() => onplay?.(current)}
                    class="flex items-center gap-2 rounded-md px-5 py-2 font-bold text-black shadow-lg transition-transform hover:scale-105"
                    style="background:var(--accent)">
              <Play size={18} fill="currentColor" /> Watch Now
            </button>
            <button data-focusable onclick={() => oninfo?.(current)}
                    class="flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 font-bold text-white backdrop-blur transition-colors hover:bg-white/20">
              <Info size={18} /> Details
            </button>
            {#if onfav}
              <button data-focusable onclick={() => onfav?.(current)} aria-label="Favorite"
                      class="rounded-md bg-white/10 p-2.5 text-white backdrop-blur transition-colors hover:bg-white/20">
                <Heart size={18} fill={current.isFavourite ? 'currentColor' : 'transparent'}
                       style={current.isFavourite ? 'color:var(--accent)' : ''} />
              </button>
            {/if}
          </div>
        </div>

        {#if medias.length > 1}
          <!-- Slide pips: hover/click targets are a desktop affordance; on mobile the row
               auto-advances (and would collide with the Watch/Details buttons), so hide them. -->
          <div class="absolute bottom-8 right-8 hidden gap-1.5 sm:flex">
            {#each medias as _, idx}
              <button data-focusable onclick={() => go(idx)} aria-label={`Slide ${idx + 1}`}
                      class="h-1 overflow-hidden rounded-full bg-white/25 transition-all duration-700"
                      style="width:{idx === i ? '3rem' : '1.5rem'}">
                <div class="h-full" style="width:{idx < i ? 100 : idx === i ? progress * 100 : 0}%;background:var(--accent)"></div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
