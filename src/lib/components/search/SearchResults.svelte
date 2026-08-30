<script lang="ts">
  // Infinite-scroll results. The parent keys this component on the serialized filter
  // string, so a NEW instance is created whenever filters change — page state resets to
  // 1 and results never mix across filter sets. Pages are fetched imperatively and
  // appended.
  //
  // VirtualGrid owns one RAF-throttled scroll path and converts visual coordinates back through
  // the document zoom; IntersectionObserver geometry is unreliable under the app's CSS `zoom`.
  // Fetches `network-only` so the normalized (graphcache) cache — which can't key the
  // unkeyed `Page` type — can't hand back a stale/embedded page for page 2+.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { searchQuery, searchVariables, STUDIO_MEDIA_QUERY, STAFF_MEDIA_QUERY, type SearchFilters } from '$lib/anilist/detail-queries'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { browseLayout } from '$lib/settings/ui'
  import { title, cover, format, season } from '$lib/anilist/media'
  import { rememberDetail } from '$lib/anilist/detail-hint'
  import type { Media } from '$lib/anilist/types'
  import { isAndroid } from '$lib/platform'
  import { gameMode } from '$lib/player/session'
  import * as h from '$lib/haptics'
  import VirtualGrid from '$lib/components/VirtualGrid.svelte'

  let { filters }: { filters: SearchFilters } = $props()

  const client = getContextClient()
  let media = $state<Media[]>([])
  let page = 1
  let hasNext = true
  let loading = $state(false)
  let error = $state('')
  const seen = new Set<number>()

  async function loadMore() {
    if (loading || !hasNext) return
    loading = true
    try {
      let batch: Media[] = []
      let nextPage = false
      if (filters.studioId) {
        const res = await client
          .query(STUDIO_MEDIA_QUERY, { id: filters.studioId, page, withPreview: !$gameMode }, { requestPolicy: 'network-only' })
          .toPromise()
        if (res.error) { error = res.error.message; hasNext = false; return }
        const conn = res.data?.Studio?.media as { nodes?: Media[]; pageInfo?: { hasNextPage?: boolean } } | undefined
        batch = conn?.nodes ?? []
        nextPage = !!conn?.pageInfo?.hasNextPage
      } else if (filters.staffId) {
        const res = await client
          .query(STAFF_MEDIA_QUERY, { id: filters.staffId, page, withPreview: !$gameMode }, { requestPolicy: 'network-only' })
          .toPromise()
        if (res.error) { error = res.error.message; hasNext = false; return }
        const staff = res.data?.Staff as {
          staffMedia?: { nodes?: Media[]; pageInfo?: { hasNextPage?: boolean } }
          characterMedia?: { edges?: { node?: Media }[]; pageInfo?: { hasNextPage?: boolean } }
        } | undefined
        const credited = staff?.staffMedia?.nodes ?? []
        const voiced = (staff?.characterMedia?.edges ?? []).map((edge) => edge.node).filter((item): item is Media => !!item)
        batch = credited.length ? credited : voiced
        nextPage = credited.length
          ? !!staff?.staffMedia?.pageInfo?.hasNextPage
          : !!staff?.characterMedia?.pageInfo?.hasNextPage
      } else {
        const res = await client
          .query(searchQuery(), { ...searchVariables(filters), page, withPreview: !$gameMode }, { requestPolicy: 'network-only' })
          .toPromise()
        if (res.error) { error = res.error.message; hasNext = false; return }
        const p = res.data?.Page as { media?: Media[]; pageInfo?: { hasNextPage?: boolean } } | undefined
        batch = p?.media ?? []
        nextPage = !!p?.pageInfo?.hasNextPage
      }
      let added = 0
      for (const m of batch) if (!seen.has(m.id)) { seen.add(m.id); media.push(m); added++ }
      hasNext = nextPage && added > 0
      page += 1
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      hasNext = false
    } finally {
      loading = false
    }
  }

  // A mid-scroll page failure latches `hasNext = false`, which permanently stops the infinite
  // scroll. Before this, that happened with no message and no spinner (the error banner was gated
  // on an EMPTY grid), so the list just silently refused to grow and only a filter change — which
  // re-keys the component — recovered. `page` is not advanced on the error path, so retrying
  // re-requests the page that failed.
  function retry() {
    error = ''
    hasNext = true
    loadMore()
  }

  function maybeLoad() {
    if (hasNext && !loading) loadMore()
  }
  onMount(() => { void loadMore() })
</script>

{#if $browseLayout === 'list'}
  <!-- List: a vertical run of compact rows (small cover + title + meta) — denser, text-forward. -->
  <VirtualGrid
    items={media}
    getKey={(m) => m.id}
    className="grid grid-cols-1 gap-1.5"
    itemClassName="min-w-0"
    endThresholdPx={1000}
    onEndReached={maybeLoad}
  >
    {#snippet children(m)}
      <a href={`/app/anime/${m.id}`} data-focusable onclick={() => { rememberDetail(m); h.tap() }}
         class="browse-render-list-item load-in flex w-full items-center gap-3 rounded-lg p-2 transition-[color,background-color,transform] active:bg-accent hover:bg-secondary {$isAndroid ? 'android-row-press' : ''}">
        <img src={cover(m)} alt="" loading="lazy" decoding="async"
             class="aspect-[2/3] w-12 shrink-0 rounded-md bg-muted object-cover" />
        <div class="min-w-0 flex-1">
          <div class="line-clamp-2 text-sm font-black leading-tight">{title(m)}</div>
          <div class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {#if format(m)}<span>{format(m)}</span>{/if}
            {#if season(m)}<span>{season(m)}</span>{/if}
            {#if m.averageScore}<span>{m.averageScore}%</span>{/if}
          </div>
        </div>
      </a>
    {/snippet}
  </VirtualGrid>
  {#if loading}
    <div class="mt-1.5 flex flex-col gap-1.5">
      {#each Array.from({ length: media.length ? 4 : 8 }) as _}
        <div class="flex items-center gap-3 p-2"><div class="aspect-[2/3] w-12 shrink-0 animate-pulse rounded-md bg-muted"></div><div class="h-4 flex-1 animate-pulse rounded bg-muted"></div></div>
      {/each}
    </div>
  {/if}
{:else}
  <!-- Grid: cover-art tiles. Three across on phones (fills edge-to-edge, no dead right margin);
       an auto-fill responsive grid on desktop. -->
  <VirtualGrid
    items={media}
    getKey={(m) => m.id}
    className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-3"
    endThresholdPx={1000}
    onEndReached={maybeLoad}
  >
    {#snippet children(m)}
      <div class="browse-render-grid-item"><SmallCard media={m} fill reserveTitleLines /></div>
    {/snippet}
  </VirtualGrid>
  {#if loading}
    <div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] sm:gap-3">
      {#each Array.from({ length: media.length ? 6 : 12 }) as _}
        <div class="aspect-[2/3] w-full animate-pulse rounded-md bg-muted"></div>
      {/each}
    </div>
  {/if}
{/if}

{#if error}
  <div class="mt-4 flex flex-wrap items-center gap-3">
    <p class="text-muted-foreground">{media.length ? "Couldn't load more results" : 'Search failed'}: {error}</p>
    <button onclick={retry} data-focusable
            class="rounded-md bg-muted px-3 py-1.5 text-sm font-black hover:bg-muted/70">Try again</button>
  </div>
{:else if !loading && !media.length}
  <p class="mt-4 text-muted-foreground">No results.</p>
{/if}
