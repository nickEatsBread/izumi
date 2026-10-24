<script lang="ts">
  import { untrack } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import type { CollectionFolder, HomeCollection } from '$lib/catalog/collections/model'
  import { collectionAddons, collectionSourceTitle, loadCollectionSource, uniqueCollectionMedia, type InstalledCollectionAddon } from '$lib/catalog/collections/resolve'
  import { enabledAddonUrls } from '$lib/stremio/sources'
  import { tmdbReadToken } from '$lib/settings/catalog'
  import { traktToken } from '$lib/trakt/config'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import CatalogSectionRow from './CatalogSectionRow.svelte'

  let { collection, folder }: { collection: HomeCollection; folder: CollectionFolder } = $props()
  interface SourceState { media: Media[]; loading: boolean; loaded: boolean; error: string; next?: number }
  let sources = $state.raw<SourceState[]>([])
  let selected = $state(-1)
  let controller: AbortController | undefined
  let installed: Promise<InstalledCollectionAddon[]> = Promise.resolve([])
  const selectedStates = $derived(sources.map((state, index) => ({ state, index })).filter(({ index }) => selected === -1 || index === selected))
  const grid = $derived(uniqueCollectionMedia(selectedStates.flatMap(({ state }) => state.media)))
  const loading = $derived(selectedStates.some(({ state }) => state.loading))

  function update(index: number, patch: Partial<SourceState>, abort: AbortController) {
    if (abort.signal.aborted || controller !== abort) return
    sources = sources.map((state, at) => at === index ? { ...state, ...patch } : state)
  }

  async function load(index: number, more = false, abort = controller) {
    if (!abort || abort.signal.aborted || sources[index]?.loading) return
    const previous = sources[index]
    const cursor = more ? previous?.next : 1
    if (!cursor) return
    update(index, { loading: true, error: '' }, abort)
    try {
      const source = folder.sources[index]
      const result = await loadCollectionSource(source, cursor, abort.signal, source.provider === 'addon' ? await installed : [])
      update(index, { media: uniqueCollectionMedia([...(more ? previous.media : []), ...result.media]), next: result.next, loaded: true }, abort)
    } catch (error) {
      update(index, { error: error instanceof Error ? error.message : String(error), loaded: true }, abort)
    } finally { update(index, { loading: false }, abort) }
  }

  async function loadSelection(index: number, abort: AbortController) {
    const queue = folder.sources.map((_, index) => index).filter((at) => (index < 0 || at === index) && !sources[at]?.loaded)
    // Request only the open folder and bound concurrency even for large community packs.
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && !abort.signal.aborted) await load(queue.shift()!, false, abort)
    }))
  }

  function choose(index: number) {
    controller?.abort()
    controller = new AbortController()
    sources = sources.map((state) => ({ ...state, loading: false }))
    selected = index
    void loadSelection(index, controller)
  }

  $effect(() => {
    void folder
    void $enabledAddonUrls
    void $tmdbReadToken
    void $traktToken
    const abort = new AbortController()
    controller = abort
    sources = folder.sources.map(() => ({ media: [], loading: false, loaded: false, error: '' }))
    const initial = collection.viewMode === 'ROWS' || collection.showAllTab ? -1 : 0
    selected = initial
    installed = folder.sources.some((source) => source.provider === 'addon') ? collectionAddons() : Promise.resolve([])
    untrack(() => { void loadSelection(initial, abort) })
    return () => { abort.abort(); controller?.abort() }
  })
</script>

<div class="pb-16 pt-16 sm:pt-20">
  <div class="relative isolate overflow-hidden px-4 pb-8 pt-6 sm:px-8">
    {#if folder.heroBackdropUrl || collection.backdropImageUrl}
      <img src={folder.heroBackdropUrl || collection.backdropImageUrl} alt="" referrerpolicy="no-referrer" class="absolute inset-0 -z-10 size-full object-cover opacity-20" />
    {/if}
    <a href="/app/home" data-focusable class="text-sm text-muted-foreground hover:text-foreground">← Home · {collection.title}</a>
    <h1 class="mt-4 text-3xl font-black">{folder.title}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{folder.sources.length} {folder.sources.length === 1 ? 'catalog' : 'catalogs'}</p>
    <a href="/app/settings/library/collections" data-focusable class="mt-3 inline-block text-sm font-semibold text-primary">Edit collection and cover</a>
  </div>

  {#if folder.sources.length > 1}
    <nav aria-label="Collection catalogs" class="mb-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:px-8">
      {#if collection.showAllTab || collection.viewMode === 'ROWS'}<button data-focusable aria-pressed={selected === -1} onclick={() => choose(-1)} class="min-h-10 shrink-0 rounded-full px-4 text-sm {selected === -1 ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">All</button>{/if}
      {#each folder.sources as source, index}
        <button data-focusable aria-pressed={selected === index} onclick={() => choose(index)} class="min-h-10 shrink-0 rounded-full px-4 text-sm {selected === index ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">{collectionSourceTitle(source, index)}</button>
      {/each}
    </nav>
  {/if}

  {#each selectedStates.filter(({ state }) => state.error) as { state, index } (index)}
    <div role="status" class="mx-4 mb-4 rounded-xl border border-destructive/30 p-4 sm:mx-8">
      <p class="font-bold">{collectionSourceTitle(folder.sources[index], index)}</p>
      <p class="mt-1 text-sm text-muted-foreground">{state.error}</p>
      <a data-focusable href={folder.sources[index].provider === 'addon' ? '/app/settings/sources' : folder.sources[index].provider === 'trakt' ? '/app/settings/accounts' : '/app/settings/library'} class="mt-3 mr-3 inline-block text-sm font-bold text-primary">Configure source</a>
      <button data-focusable onclick={() => load(index)} class="mt-3 min-h-10 rounded-md bg-secondary px-4 text-sm font-bold">Retry</button>
    </div>
  {/each}

  {#if collection.viewMode === 'ROWS' && selected === -1}
    <div class="space-y-6">
      {#each selectedStates as { state, index } (index)}
        {#if state.media.length}
          <CatalogSectionRow section={{ id: String(index), title: collectionSourceTitle(folder.sources[index], index), media: state.media }} />
        {/if}
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-x-3 gap-y-6 px-4 sm:grid-cols-4 sm:px-8 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
      {#each grid as media (`${media.catalog?.provider}:${media.catalog?.type}:${media.catalog?.id ?? media.id}`)}
        <SmallCard {media} fill simpleHover />
      {/each}
    </div>
  {/if}
  {#if loading}<p role="status" class="px-4 py-8 text-sm text-muted-foreground sm:px-8">Loading catalogs…</p>{/if}
  {#if !loading && !grid.length && !selectedStates.some(({ state }) => state.error)}
    <p class="px-4 py-8 text-sm text-muted-foreground sm:px-8">No titles in this folder.</p>
  {/if}
  <div class="mt-6 flex flex-wrap gap-2 px-4 sm:px-8">
    {#each selectedStates.filter(({ state }) => state.next != null) as { state, index } (index)}
      <button data-focusable disabled={state.loading} onclick={() => load(index, true)} class="min-h-10 rounded-md bg-secondary px-4 text-sm font-bold disabled:opacity-50">{state.loading ? 'Loading…' : `More · ${collectionSourceTitle(folder.sources[index], index)}`}</button>
    {/each}
  </div>
</div>
