<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { TabbedGridBlock } from '$lib/home/blocks'
  import { appendUnique, loadRowPage, resolveRowId, rowSource } from '$lib/home/row-source'
  import { isMobile } from '$lib/platform'
  import { nearViewport } from '$lib/util/near-viewport'
  import Pager from '../Pager.svelte'

  // A tab strip over a poster grid: each tab is one catalog row, paged in place.
  let { block, target, optionIds = [] }: { block: TabbedGridBlock; target: CatalogHomeTarget; optionIds?: string[] } = $props()

  let section = $state<HTMLElement>()
  let visible = $state(false)
  let selected = $state('')
  let page = $state(1)
  let media = $state.raw<Media[]>([])
  let hasNext = $state(false)
  let lastPage = $state<number | undefined>()
  let loading = $state(false)
  let error = $state('')
  let retry = $state(0)

  const labels = $derived(block.tabs.map((tab) => tab.label))
  // Until the viewer picks one, the block's opening tab (`default`, else the first) is shown.
  const current = $derived(labels.includes(selected) ? selected : labels[block.default ?? 0] ?? labels[0] ?? '')
  const tab = $derived(block.tabs.find((item) => item.label === current))
  const rowId = $derived(tab ? resolveRowId(target, tab.role, optionIds) : null)
  const columns = $derived($isMobile ? Math.min(3, block.columns) : block.columns)

  function choose(label: string) {
    if (label === current) return
    selected = label
    page = 1
  }

  $effect(() => {
    if (!visible) return
    void retry
    const id = rowId
    const pageNumber = page
    const size = block.pageSize
    const append = block.pagination === 'more' && pageNumber > 1
    if (!id) {
      media = []
      hasNext = false
      return
    }
    const abort = new AbortController()
    loading = true
    error = ''
    loadRowPage(target, id, pageNumber, size, abort.signal).then((result) => {
      if (abort.signal.aborted) return
      media = append ? appendUnique(media, result.media) : appendUnique([], result.media)
      hasNext = result.hasNextPage
      lastPage = result.lastPage
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })

  function goTo(next: number) {
    page = next
    if (block.pagination === 'numbers') section?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // "Load more" accumulates every page into one list, so a card's rank is just its place in it.
  // Page numbers instead reload each page in isolation — reconstructing an absolute rank from
  // `page`/`pageSize` only holds for AniList rows, since only their pages actually honour our
  // configured pageSize; another provider's own page size can differ, so its cards get no rank.
  function cardPosition(index: number): number | undefined {
    if (block.pagination === 'more') return index + 1
    if (rowId && rowSource(target, rowId)?.kind === 'anilist') return (page - 1) * block.pageSize + index + 1
    return undefined
  }
</script>

<section bind:this={section} data-block data-slot="block.tabbed-grid" use:nearViewport={{ onEnter: () => (visible = true) }}
  class="mb-8 scroll-mt-20 px-4 sm:px-8">
  {#if block.title}<h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title}</h2>{/if}
  {#if labels.length > 1}<div data-nav-row><Tabs tabs={labels} bind:active={() => current, choose} /></div>{/if}
  {#if !block.tabs.length}
    <p class="text-sm text-muted-foreground">Choose rows for this block in Edit Home.</p>
  {:else}
    {#if error}
      <p role="alert" class="mb-2 text-sm text-muted-foreground">{error}</p>
      <button type="button" data-part="button" data-variant="secondary" data-focusable onclick={() => retry++}
        class="mb-3 min-h-9 rounded-md bg-secondary px-4 text-sm font-bold transition hover:bg-accent">Retry</button>
    {/if}
    <div data-nav-row data-nav-row-wrap data-nav-row-items class="grid gap-x-3 gap-y-5" style:grid-template-columns={`repeat(${columns}, minmax(0, 1fr))`}>
      {#if !visible || (loading && !media.length)}
        {#each Array.from({ length: Math.min(block.pageSize, columns * 2) }) as _, index (index)}
          <div class="aspect-[2/3] rounded-md skeloader"></div>
        {/each}
      {:else}
        {#each media as item, index (item.id)}
          <div data-part="block.item" class="min-w-0"><SmallCard media={item} fill reserveTitleLines position={cardPosition(index)} /></div>
        {/each}
      {/if}
    </div>
    {#if visible && !loading && !media.length && !error}<p class="text-sm text-muted-foreground">Nothing to show here yet.</p>{/if}
    <Pager {page} {hasNext} {lastPage} mode={block.pagination} {loading} onpage={goTo} />
  {/if}
</section>
