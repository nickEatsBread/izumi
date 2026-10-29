<script module lang="ts">
  import { createBrowseFeeds } from '$lib/catalog/browse'
  // One cache for the session: Back from a title draws the listing at once.
  const feeds = createBrowseFeeds()
</script>

<script lang="ts">
  // A listing a source put in the menu (its watchlist, its history, its seasons) as a grid of its
  // titles. One that names an extra (a season, say) opens on a wall of that extra's options first,
  // each narrowing the grid to it.
  import { untrack } from 'svelte'
  import { page } from '$app/state'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import VirtualGrid from '$lib/components/VirtualGrid.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { sourceListingFetch } from '$lib/catalog/browse-fetch'
  import type { BrowseFeed } from '$lib/catalog/browse'
  import { mediaKey } from '$lib/catalog/identity'
  import { isSourceSelection, sourceAddon, sourcePackageOf, type SourceAddon } from '$lib/catalog/source-catalogs'
  import { listingHref, sourceMenus } from '$lib/catalog/source-menus'
  import { focusOnMount } from '$lib/nav'
  import { gameMode } from '$lib/player/session'
  import { catalogProvider } from '$lib/settings/catalog'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'

  heroMedia.set(null)

  let loaded = $state.raw<{ for: string; addon: SourceAddon } | null>(null)
  let addonError = $state('')
  let attempt = $state(0)
  $effect(() => {
    const selection = $catalogProvider
    void attempt
    addonError = ''
    if (!isSourceSelection(selection)) return
    let live = true
    sourceAddon(sourcePackageOf(selection))
      .then((addon) => { if (live) loaded = { for: selection, addon } })
      .catch((reason) => { if (live) addonError = reason instanceof Error ? reason.message : String(reason) })
    return () => { live = false }
  })
  const addon = $derived(loaded?.for === $catalogProvider ? loaded.addon : null)
  const menu = $derived(addon ? sourceMenus(addon.manifest).find((item) => item.value === page.url.searchParams.get('catalog')) : undefined)
  const option = $derived(menu?.extra ? page.url.searchParams.get(menu.extra) ?? '' : '')
  const choosing = $derived(!!menu?.extra && !option)
  const title = $derived(menu ? (option ? option : menu.label) : '')

  // The grid on screen: one per (source, listing, option).
  const key = $derived(addon && menu && !choosing ? `${addon.packageId}|${menu.value}|${option}` : '')
  let feed = $state.raw<BrowseFeed | undefined>()
  let loading = $state(false)
  let error = $state('')
  $effect(() => {
    const current = key
    untrack(() => {
      feeds.cancelExcept(current)
      feed = current ? feeds.cached(current) : undefined
      error = ''
      loading = false
      if (current && !feed) void more()
    })
  })
  async function more() {
    const current = key
    if (!current || !addon || !menu || feed?.hasNext === false) return
    loading = true
    try {
      const next = await feeds.more(current, sourceListingFetch(addon.packageId, menu.entry, menu.extra ? { [menu.extra]: option } : {}))
      if (current === key) feed = next
    } catch (reason) {
      if (current === key) error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (current === key) loading = false
    }
  }
  const loadAtEnd = () => { if (!error && !loading) void more() }
  const retry = () => { error = ''; void more() }

  // With a pad, the grid lands on its first title once one shows, as Browse does.
  let results = $state<HTMLElement>()
  let landedFor = ''
  $effect(() => {
    if (!$gameMode || !feed?.media.length || landedFor === key) return
    landedFor = key
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      results?.querySelector<HTMLElement>('[data-focusable]')?.focus({ preventScroll: true })
    })
  })
  const focusOnMountIf = (node: HTMLElement, on: boolean) => { if (on) focusOnMount(node) }
  const skeletons = Array.from({ length: 12 })
</script>

{#if $offlineMode}
  <OfflineUnavailable title="This list is unavailable offline" subtitle="It needs a connection. Your downloaded titles are available on the Downloads page." />
{:else}
<div data-slot="listing" data-state={choosing ? 'choosing' : undefined} class="min-h-screen px-4 pb-20 pt-4 sm:px-8 sm:pt-8">
  <h1 data-part="listing.title" class="mb-6 text-2xl font-black sm:text-3xl">{title || ' '}</h1>
  {#if !isSourceSelection($catalogProvider)}
    <p data-part="listing.empty" data-state="empty" class="text-sm text-muted-foreground">Open a source's screen to see its lists.</p>
  {:else if addonError}
    <div data-part="listing.empty" data-state="error" class="flex flex-col items-start gap-3 text-sm text-muted-foreground">
      <p>{addonError}</p>
      <button type="button" data-focusable use:focusOnMount onclick={() => attempt++} class="rounded-lg bg-secondary px-4 py-2 font-bold text-foreground hover:bg-accent">Try again</button>
    </div>
  {:else if addon && !menu}
    <p data-part="listing.empty" data-state="empty" class="text-sm text-muted-foreground">This source no longer offers this list.</p>
  {:else if choosing && menu}
    <div data-part="listing.chips" role="list" class="flex flex-wrap gap-3">
      {#each menu.options as choice, index (choice)}
        <a role="listitem" data-part="listing.chip" data-focusable href={listingHref(menu, choice)} use:focusOnMountIf={index === 0}
           class="rounded-full bg-secondary/90 px-5 py-2.5 text-sm font-bold text-foreground/85 outline-none hover:bg-accent focus-visible:bg-primary focus-visible:text-primary-foreground">{choice}</a>
      {/each}
    </div>
  {:else}
    <section bind:this={results} aria-busy={loading}>
      {#if error && !feed?.media.length}
        <div data-part="listing.empty" data-state="error" class="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p class="text-sm">{error}</p>
          <button type="button" data-focusable use:focusOnMount onclick={retry} class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
        </div>
      {:else if feed?.media.length}
        <VirtualGrid
          part="listing.grid"
          variant="grid"
          items={feed.media}
          getKey={mediaKey}
          className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-5"
          onEndReached={loadAtEnd}
        >
          {#snippet children(item)}<SmallCard media={item} fill reserveTitleLines />{/snippet}
        </VirtualGrid>
        {#if loading}
          <p data-part="listing.more" class="mt-6 text-center text-sm text-muted-foreground">Loading more…</p>
        {:else if error}
          <div data-part="listing.more" data-state="error" class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            Couldn't load more: {error}
            <button type="button" data-focusable onclick={retry} class="rounded-md bg-secondary px-3 py-1.5 font-bold text-foreground">Retry</button>
          </div>
        {/if}
      {:else if feed && !loading}
        <p data-part="listing.empty" data-state="empty" class="rounded-xl bg-secondary/40 p-8 text-center text-muted-foreground">Nothing here yet.</p>
      {:else}
        <div data-part="listing.grid" data-variant="grid" data-state="loading" aria-hidden="true"
             class="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-5">
          {#each skeletons as _, index (index)}<div class="aspect-[2/3] w-full rounded-md skeloader"></div>{/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
{/if}
