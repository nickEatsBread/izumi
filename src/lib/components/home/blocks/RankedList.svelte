<script lang="ts">
  import { cardCover, format, mediaHref, title as mediaTitle } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { RankedListBlock } from '$lib/home/blocks'
  import { appendUnique, loadRowPage, resolveRowId } from '$lib/home/row-source'
  import { nearViewport } from '$lib/util/near-viewport'

  // A numbered top list (thumbnail, title, facts), optionally switching between rows with tabs.
  let { block, target, optionIds = [] }: { block: RankedListBlock; target: CatalogHomeTarget; optionIds?: string[] } = $props()

  let visible = $state(false)
  let selected = $state('')
  let media = $state.raw<Media[]>([])
  let loading = $state(false)
  let error = $state('')

  const labels = $derived(block.tabs.map((tab) => tab.label))
  const current = $derived(labels.includes(selected) ? selected : labels[0] ?? '')
  const tab = $derived(block.tabs.find((item) => item.label === current))
  const rowId = $derived(tab ? resolveRowId(target, tab.role, optionIds) : null)

  $effect(() => {
    if (!visible) return
    const id = rowId
    const limit = block.limit
    if (!id) {
      media = []
      return
    }
    const abort = new AbortController()
    loading = true
    error = ''
    loadRowPage(target, id, 1, limit, abort.signal).then((result) => {
      if (!abort.signal.aborted) media = appendUnique([], result.media).slice(0, limit)
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })

  const facts = (item: Media) => [format(item), item.episodes ? `${item.episodes} eps` : '', item.averageScore ? `${item.averageScore}%` : ''].filter(Boolean).join(' · ')
</script>

<section data-block data-slot="block.ranked-list" data-nav-row use:nearViewport={{ onEnter: () => (visible = true) }} class="mb-8 px-4 sm:px-8">
  <h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title || current || 'Top titles'}</h2>
  {#if labels.length > 1}<Tabs tabs={labels} bind:active={() => current, (label) => (selected = label)} variant="segmented" />{/if}
  {#if !block.tabs.length}
    <p class="text-sm text-muted-foreground">Choose rows for this block in Edit Home.</p>
  {:else}
    {#if error}<p role="alert" class="mb-3 text-sm text-muted-foreground">{error}</p>{/if}
    <ol data-nav-row-items class="space-y-1.5">
      {#if !visible || (loading && !media.length)}
        {#each Array.from({ length: Math.min(block.limit, 5) }) as _, index (index)}<li class="h-[4.75rem] rounded-lg skeloader"></li>{/each}
      {:else}
        {#each media as item, index (item.id)}
          <li>
            <a data-part="block.item" data-focusable href={mediaHref(item)} class="flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-secondary/60">
              <span data-part="block.rank" class="w-8 shrink-0 text-center text-xl font-black tabular-nums {index < 3 ? 'text-theme' : 'text-muted-foreground'}">{index + 1}</span>
              <img data-part="card.art" src={cardCover(item, 48)} alt="" loading="lazy" decoding="async" draggable="false" class="aspect-[2/3] w-12 shrink-0 rounded bg-muted object-cover" />
              <span class="min-w-0 flex-1">
                <span data-part="card.title" class="line-clamp-2 text-sm font-bold">{mediaTitle(item)}</span>
                {#if facts(item)}<span data-part="card.meta" class="mt-0.5 block text-xs text-muted-foreground">{facts(item)}</span>{/if}
              </span>
            </a>
          </li>
        {/each}
      {/if}
    </ol>
  {/if}
</section>
