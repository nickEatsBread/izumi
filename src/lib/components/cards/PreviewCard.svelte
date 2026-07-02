<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title, format, season } from '$lib/anilist/media'
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
</script>

<div class="w-[17.5rem] overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border">
  <div class="relative h-40 overflow-hidden bg-muted">
    <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
    {#if trailerId}
      <YoutubeTrailer id={trailerId} />
    {/if}
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-card to-transparent"></div>
  </div>
  <div class="p-3">
    <div class="truncate font-black">{title(media)}</div>
    <div class="mt-2 flex gap-2">
      <button class="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary py-1 text-sm font-bold text-primary-foreground">
        <Play size={14} /> Play
      </button>
      <button aria-label="Favorite" class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
        <Heart size={16} />
      </button>
      <button aria-label="Add to list" class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
        <Plus size={16} />
      </button>
    </div>
    <div class="mt-2 text-[11px] text-muted-foreground">{format(media)} · {media.episodes ?? '?'} eps · {season(media)} · {media.averageScore ?? '–'}%</div>
    <p class="mt-1 line-clamp-4 text-[0.7rem] text-muted-foreground">{(media.description ?? '').replace(/<[^>]+>/g, '')}</p>
  </div>
</div>
