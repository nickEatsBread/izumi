<script lang="ts">
  // A single rich episode card. When `showThumb`, a 16:9 AniZip thumbnail heads
  // the card; otherwise (no real per-episode art) it renders a compact text-forward
  // layout — episode number + title + rating + progress — with no image, so we
  // never pass off the show's banner/cover as a fake per-episode still. Upcoming
  // episodes render dimmed + non-clickable.
  import type { Media } from '$lib/anilist/types'
  import type { EpMeta } from '$lib/anizip/types'
  import { ratingBg } from '$lib/anilist/media'
  import { episodePercent } from '$lib/player/progress'

  let {
    media, ep, meta, showThumb, released, isNext, next, onplay,
  }: {
    media: Media
    ep: number
    meta?: EpMeta
    showThumb: boolean
    released: boolean
    isNext: boolean
    next?: { episode: number; timeUntilAiring: number } | null
    onplay: (ep: number) => void
  } = $props()

  const img = $derived(meta?.image)
  const epTitle = $derived(meta?.title || `Episode ${ep}`)
  const rating = $derived(typeof meta?.rating === 'number' ? Math.round(meta.rating * 10) : undefined)

  // Fully watched if the tracker says we're past this episode; otherwise use the
  // saved position/duration fraction. Percent is 0..100 for the bottom bar.
  const trackedDone = $derived((media.mediaListEntry?.progress ?? 0) >= ep)
  const pct = $derived(released ? (trackedDone ? 100 : Math.round(episodePercent(media.id, ep) * 100)) : 0)

  function countdown(sec?: number) {
    if (!sec) return ''
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
</script>

<button
  data-focusable
  disabled={!released}
  onclick={() => released && onplay(ep)}
  title={released ? `Play — ${epTitle}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
  class="group flex flex-col overflow-hidden rounded-lg text-left transition-transform
    {released ? 'bg-secondary hover:scale-[1.02] hover:bg-accent' : 'cursor-not-allowed bg-background/40 opacity-60'}"
>
  {#if showThumb && img}
    <div class="relative aspect-video w-full overflow-hidden bg-muted">
      <img src={img} alt="" loading="lazy"
           class="h-full w-full object-cover transition-transform duration-300 {released ? 'group-hover:scale-105' : 'grayscale'}" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>

      <span class="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-black">{ep}</span>

      {#if rating != null}
        <span class="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[0.65rem] font-black text-white {ratingBg(rating)}">{rating}%</span>
      {/if}

      {#if released}
        <span class="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span class="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-black">▶</span>
        </span>
      {:else}
        <span class="absolute bottom-2 left-2 text-[0.7rem] font-bold text-theme">
          {isNext ? `airing in ${countdown(next?.timeUntilAiring)}` : 'Not aired'}
        </span>
      {/if}

      <!-- Watch-progress bar -->
      {#if pct > 0}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <span class="block h-full bg-theme" style={`width:${pct}%`}></span>
        </span>
      {/if}
    </div>

    <div class="p-2">
      <span class="block truncate text-sm font-bold">{epTitle}</span>
      <span class="block text-[0.7rem] text-muted-foreground">Episode {ep}</span>
    </div>
  {:else}
    <!-- Text-forward card: no per-episode image available. -->
    <div class="relative flex items-center gap-3 p-3">
      <span class="grid h-9 min-w-9 shrink-0 place-items-center rounded bg-background/50 px-1.5 text-xs font-black tabular-nums">{ep}</span>
      <div class="min-w-0 flex-1">
        <span class="block truncate text-sm font-bold">{epTitle}</span>
        {#if isNext}
          <span class="block text-[0.7rem] font-bold text-theme">airing in {countdown(next?.timeUntilAiring)}</span>
        {:else if !released}
          <span class="block text-[0.7rem] text-muted-foreground">Not aired</span>
        {:else}
          <span class="block text-[0.7rem] text-muted-foreground">Episode {ep}</span>
        {/if}
      </div>

      {#if rating != null}
        <span class="shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-black text-white {ratingBg(rating)}">{rating}%</span>
      {/if}

      {#if released}
        <span class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">▶</span>
      {/if}

      <!-- Watch-progress bar -->
      {#if pct > 0}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <span class="block h-full bg-theme" style={`width:${pct}%`}></span>
        </span>
      {/if}
    </div>
  {/if}
</button>
