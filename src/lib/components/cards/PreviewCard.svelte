<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title, format, season } from '$lib/anilist/media'
  import { goto } from '$app/navigation'
  import { anilistToken } from '$lib/anilist/auth'
  import { toggleFavourite, setStatus, anyTrackerConnected } from '$lib/trackers'
  import YoutubeTrailer from './YoutubeTrailer.svelte'
  import Play from 'lucide-svelte/icons/play'
  import Heart from 'lucide-svelte/icons/heart'
  import Plus from 'lucide-svelte/icons/plus'
  let { media }: { media: Media } = $props()

  // YouTube trailers only; WebKitGTK (no `credentialless`) will just show the still.
  const trailerId = $derived(
    media.trailer?.id && (!media.trailer.site || media.trailer.site.toLowerCase() === 'youtube')
      ? media.trailer.id
      : undefined,
  )

  // Favourite is AniList-only; bookmark (PLANNING) works on any connected tracker.
  const canFavourite = $derived(!!$anilistToken)
  const canBookmark = $derived(anyTrackerConnected())
  let busy = $state(false)
  async function favourite(e: Event) { e.stopPropagation(); if (busy) return; busy = true; try { await toggleFavourite(media) } catch { /* ignore */ } finally { busy = false } }
  async function bookmark(e: Event) { e.stopPropagation(); if (busy) return; busy = true; try { await setStatus(media, 'PLANNING') } finally { busy = false } }
  const openDetail = () => goto(`/app/anime/${media.id}`)
</script>

<div class="w-[17.5rem] cursor-pointer overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border"
     onclick={openDetail} role="link" tabindex="0"
     onkeydown={(e) => { if (e.key === 'Enter') openDetail() }}>
  <div class="relative h-40 overflow-hidden bg-muted">
    <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
    {#if trailerId}
      <YoutubeTrailer id={trailerId} />
    {/if}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"></div>
  </div>
  <div class="p-3">
    <div class="truncate font-black">{title(media)}</div>
    <div class="mt-2 flex gap-2">
      <button onclick={() => goto(`/app/anime/${media.id}`)}
              class="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary py-1 text-sm font-bold text-primary-foreground">
        <Play size={14} /> Play
      </button>
      <button aria-label="Favorite" onclick={favourite} disabled={!canFavourite || busy}
              title={canFavourite ? 'Favourite' : 'Connect AniList to favourite'}
              class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground disabled:opacity-40">
        <Heart size={16} />
      </button>
      <button aria-label="Add to list" onclick={bookmark} disabled={!canBookmark || busy}
              title={canBookmark ? 'Add to Planning' : 'Connect a tracker to bookmark'}
              class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground disabled:opacity-40">
        <Plus size={16} />
      </button>
    </div>
    <div class="mt-2 text-[11px] text-muted-foreground">{format(media)} · {media.episodes ?? '?'} eps · {season(media)} · {media.averageScore ?? '–'}%</div>
    <p class="mt-1 line-clamp-4 text-[0.7rem] text-muted-foreground">{(media.description ?? '').replace(/<[^>]+>/g, '')}</p>
  </div>
</div>
