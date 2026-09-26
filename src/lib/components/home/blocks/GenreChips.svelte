<script lang="ts">
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { GenreChipsBlock } from '$lib/home/blocks'
  import { genreChipList, loadGenres } from '$lib/home/genres'

  // "All" plus genre shortcuts; a chip opens search filtered to that genre.
  let { block, target }: { block: GenreChipsBlock; target: CatalogHomeTarget } = $props()
  let available = $state<string[] | null>(null)

  $effect(() => {
    const current = target
    const abort = new AbortController()
    available = null
    loadGenres(current, abort.signal)
      .then((genres) => { if (!abort.signal.aborted) available = genres })
      .catch(() => { if (!abort.signal.aborted) available = [] })
    return () => abort.abort()
  })

  const chips = $derived(genreChipList(block.genres, available))
  const href = (genre: string) => `/app/search?genre=${encodeURIComponent(genre)}`
</script>

<section data-block data-slot="block.genre-chips" data-nav-row class="mb-6 px-4 sm:px-8">
  {#if block.title}<h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title}</h2>{/if}
  <div data-nav-row-items class="flex flex-wrap gap-2">
    {#if block.all}
      <a data-part="chip" data-active="true" data-focusable href="/app/search" class="rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-primary-foreground">All</a>
    {/if}
    {#each chips as genre (genre)}
      <a data-part="chip" data-focusable href={href(genre)} class="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-bold text-foreground transition hover:bg-accent">{genre}</a>
    {/each}
  </div>
</section>
