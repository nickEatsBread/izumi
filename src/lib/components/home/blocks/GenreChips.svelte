<script lang="ts">
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { GenreChipsBlock } from '$lib/home/blocks'
  import { genreChipList, loadGenres } from '$lib/home/genres'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'

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

  // Scroll arrows for a theme that makes the chips one sideways rail: hidden until a stylesheet shows
  // them (`chips.step`), each disabled while the rail cannot scroll that way.
  let track = $state<HTMLElement>()
  let canPrev = $state(false)
  let canNext = $state(false)
  function measure() {
    if (!track) return
    canPrev = track.scrollLeft > 1
    canNext = track.scrollLeft + track.clientWidth < track.scrollWidth - 1
  }
  $effect(() => {
    const el = track
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure) }
  })
  $effect(() => { void chips; requestAnimationFrame(measure) })
  const step = (dir: 1 | -1) => track?.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth' })
</script>

<section data-block data-slot="block.genre-chips" class="mb-6 px-4 sm:px-8">
  {#if block.title}<h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title}</h2>{/if}
  <button type="button" data-part="chips.step" data-dir="previous" disabled={!canPrev} aria-label="Earlier genres" onclick={() => step(-1)} class="hidden"><ChevronLeft size={18} /></button>
  <div bind:this={track} data-part="chips.track" data-nav-row data-nav-row-wrap data-nav-row-items class="flex flex-wrap gap-2">
    {#if block.all}
      <a data-part="chip" data-active="true" data-focusable href="/app/search" class="rounded-full bg-primary px-3.5 py-1.5 text-sm font-bold text-primary-foreground">All</a>
    {/if}
    {#each chips as genre (genre)}
      <a data-part="chip" data-focusable href={href(genre)} class="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-bold text-foreground transition hover:bg-accent">{genre}</a>
    {/each}
  </div>
  <button type="button" data-part="chips.step" data-dir="next" disabled={!canNext} aria-label="More genres" onclick={() => step(1)} class="hidden"><ChevronRight size={18} /></button>
</section>
