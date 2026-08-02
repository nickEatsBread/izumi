<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { fetchFranchise, sortFranchiseMedia } from '$lib/anilist/franchise'
  import { title, cover, isReadingMedia, mediaHref } from '$lib/anilist/media'
  import { reliableImage } from '$lib/util/reliable-image'
  import Clapperboard from 'lucide-svelte/icons/clapperboard'

  let { media }: { media: Media } = $props()
  let items = $state<Media[]>([])
  let loading = $state(false)

  $effect(() => {
    const id = media.id
    // Seed from the edges we already hold while the full walk runs. Reading titles are dropped for
    // the same reason the walk itself drops them: this strip is the watch order of a franchise, and
    // a manga has no place in it (nor on the anime route these cards point at).
    items = sortFranchiseMedia([
      media,
      ...(media.relations?.edges ?? [])
        .filter((edge) => edge.relationType !== 'SOURCE' && !isReadingMedia(edge.node))
        .map((edge) => edge.node),
    ])
    let stale = false
    loading = true
    fetchFranchise(id)
      .then((result) => { if (!stale && result.length > 1) items = result })
      .catch(() => {})
      .finally(() => { if (!stale) loading = false })
    return () => { stale = true }
  })

  const label = (item: Media) =>
    [item.format?.replaceAll('_', ' '), item.seasonYear ?? item.startDate?.year].filter(Boolean).join(' · ')
</script>

{#if items.length > 1}
  <section class="mb-6 rounded-xl border border-border bg-secondary/25 p-3 sm:p-4">
    <div class="mb-3 flex items-center gap-2">
      <Clapperboard size={17} class="text-theme" />
      <h2 class="text-sm font-black">Franchise</h2>
      <span class="text-xs text-muted-foreground">{items.length} titles in release order{loading ? ' · expanding…' : ''}</span>
    </div>
    <div class="flex snap-x gap-2.5 overflow-x-auto pb-1">
      {#each items as item (item.id)}
        <a
          href={mediaHref(item)}
          data-focusable
          aria-current={item.id === media.id ? 'page' : undefined}
          class="flex w-48 shrink-0 snap-start items-center gap-2.5 rounded-lg border p-2 transition-colors
            {item.id === media.id ? 'border-theme bg-theme/10' : 'border-border bg-background/50 hover:bg-accent'}"
        >
          <img use:reliableImage={cover(item)} alt="" class="h-16 w-11 shrink-0 rounded object-cover" />
          <span class="min-w-0">
            <span class="line-clamp-2 text-xs font-black leading-tight">{title(item)}</span>
            <span class="mt-1 block text-[0.65rem] text-muted-foreground">{label(item)}</span>
            {#if item.id === media.id}<span class="mt-1 block text-[0.6rem] font-black uppercase tracking-wide text-theme">Currently viewing</span>{/if}
          </span>
        </a>
      {/each}
    </div>
  </section>
{/if}
