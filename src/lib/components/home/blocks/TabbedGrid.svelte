<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { TabbedGridBlock } from '$lib/home/blocks'
  import { appendUnique, loadRowPage, resolveRowId } from '$lib/home/row-source'
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

  const labels = $derived(block.tabs.map((tab) => tab.label))
  const current = $derived(labels.includes(selected) ? selected : labels[0] ?? '')
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
</script>

<section bind:this={section} data-block data-slot="block.tabbed-grid" data-nav-row data-nav-row-wrap="" use:nearViewport={{ onEnter: () => (visible = true) }}
  class="mb-8 scroll-mt-20 px-4 sm:px-8">
  {#if block.title}<h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title}</h2>{/if}
  {#if labels.length > 1}<Tabs tabs={labels} bind:active={() => current, choose} />{/if}
  {#if !block.tabs.length}
    <p class="text-sm text-muted-foreground">Choose rows for this block in Edit Home.</p>
  {:else}
    {#if error}<p role="alert" class="mb-3 text-sm text-muted-foreground">{error}</p>{/if}
    <div data-nav-row-items class="grid gap-x-3 gap-y-5" style:grid-template-columns={`repeat(${columns}, minmax(0, 1fr))`}>
      {#if !visible || (loading && !media.length)}
        {#each Array.from({ length: Math.min(block.pageSize, columns * 2) }) as _, index (index)}
          <div class="aspect-[2/3] rounded-md skeloader"></div>
        {/each}
      {:else}
        {#each media as item, index (item.id)}
          <div data-part="block.item" class="min-w-0"><SmallCard media={item} fill reserveTitleLines position={(page - 1) * block.pageSize + index + 1} /></div>
        {/each}
      {/if}
    </div>
    {#if visible && !loading && !media.length && !error}<p class="text-sm text-muted-foreground">Nothing to show here yet.</p>{/if}
    <Pager {page} {hasNext} {lastPage} mode={block.pagination} {loading} onpage={goTo} />
  {/if}
</section>
