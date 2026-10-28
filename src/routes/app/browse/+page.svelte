<script module lang="ts">
  import { createBrowseFeeds } from '$lib/catalog/browse'
  // One cache for the session: Back from a title, or a return to a sort, draws its listing at once.
  const feeds = createBrowseFeeds()
</script>

<script lang="ts">
  // Browse: the active catalog's whole listing, a sort (Popular, Newest, A–Z, …) and a category down
  // the side. A switch lights its pill or category at once and shows the cached listing, or
  // skeletons while it loads; the listing switched away from has its request cancelled.
  import { setContext, tick, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { getContextClient } from '@urql/svelte'
  import { page } from '$app/state'
  import { afterNavigate, replaceState } from '$app/navigation'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import VirtualGrid from '$lib/components/VirtualGrid.svelte'
  import HomeBlockView from '$lib/components/home/HomeBlockView.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import BrowseSorts from '$lib/components/browse/BrowseSorts.svelte'
  import BrowseCategories from '$lib/components/browse/BrowseCategories.svelte'
  import { browseKey, browseSearch, pickBrowseSort, type BrowseFeed } from '$lib/catalog/browse'
  import { cachedBrowseCatalog, loadBrowseCatalog, type BrowseCatalog } from '$lib/catalog/browse-fetch'
  import { isSourceSelection } from '$lib/catalog/source-catalogs'
  import { mediaKey } from '$lib/catalog/identity'
  import { resolveThemeHome } from '$lib/home/theme-layout'
  import { activeThemeLayout } from '$lib/themes/layout-state'
  import { CARD_FAMILY, type ThemeLayout, type ThemeLayoutEntry } from '$lib/themes/presentation'
  import { catalogProvider, isLegacyAniListCatalog } from '$lib/settings/catalog'
  import { showAdult } from '$lib/settings/ui'
  import { offlineMode } from '$lib/stores/offline'
  import { heroMedia } from '$lib/stores/hero'
  import { anilistDegradedBannerVisible } from '$lib/anilist/degraded'
  import { gameMode } from '$lib/player/session'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'

  setContext(CARD_FAMILY, 'search')
  heroMedia.set(null)

  const client = getContextClient()
  const selection = $derived($catalogProvider)

  let sort = $state(page.url.searchParams.get('sort') ?? '')
  let genre = $state(page.url.searchParams.get('genre') ?? '')
  // A link into Browse while it is open (a "View more", the nav item) starts from what it names.
  afterNavigate((navigation) => {
    if (navigation.type !== 'link' && navigation.type !== 'goto') return
    sort = page.url.searchParams.get('sort') ?? ''
    genre = page.url.searchParams.get('genre') ?? ''
  })

  let loaded = $state.raw<{ for: string; catalog: BrowseCatalog } | null>(null)
  let catalogError = $state('')
  let catalogAttempt = $state(0)
  const catalogFor = $derived(`${selection}|${$showAdult}`)
  const catalog = $derived(loaded?.for === catalogFor ? loaded.catalog : null)
  $effect(() => {
    const target = selection
    const key = catalogFor
    void catalogAttempt
    catalogError = ''
    const cached = cachedBrowseCatalog(target)
    if (cached) { loaded = { for: key, catalog: cached }; return }
    let live = true
    loadBrowseCatalog(target, client)
      .then((value) => { if (live) loaded = { for: key, catalog: value } })
      .catch((reason) => { if (live) catalogError = reason instanceof Error ? reason.message : String(reason) })
    return () => { live = false }
  })

  const sorts = $derived(catalog?.sorts ?? [])
  const activeSort = $derived(pickBrowseSort(sort, sorts))
  const genres = $derived(catalog?.genres(activeSort) ?? [])
  const activeGenre = $derived(genres.includes(genre) ? genre : '')

  // The listing on screen: one per (catalog, sort, category), and the 18+ setting it was read with.
  const key = $derived(catalog && sorts.length ? browseKey(selection, activeSort, activeGenre, $showAdult) : '')
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
    if (!current || !catalog || feed?.hasNext === false) return
    loading = true
    try {
      const next = await feeds.more(current, catalog.fetch(activeSort, activeGenre))
      if (current === key) feed = next
    } catch (reason) {
      if (current === key) error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (current === key) loading = false
    }
  }

  // A failed page stops the scroll from asking again until Retry.
  const loadAtEnd = () => { if (!error && !loading) void more() }
  const retry = () => { error = ''; void more() }

  let results = $state<HTMLElement>()
  async function choose(next: { sort?: string; genre?: string }) {
    // A bumper switch from inside the grid: the focused card is about to go, so focus moves to the lit pill.
    const fromGrid = !!results?.contains(document.activeElement)
    if (next.sort !== undefined) sort = next.sort
    if (next.genre !== undefined) genre = next.genre
    h.tap()
    window.scrollTo({ top: 0 })
    if (!fromGrid) return
    await tick()
    document.querySelector<HTMLElement>('[data-nav-id="browse-sort"]')?.focus({ preventScroll: true })
  }

  // The view lives in the address bar, so Back and a reload keep it. replaceState: a switch is not a page.
  $effect(() => {
    if (!catalog) return
    const next = page.url.pathname + browseSearch(activeSort, activeGenre, sorts[0]?.value ?? '')
    if (next === location.pathname + location.search) return
    try { replaceState(next, page.state) } catch { /* router not ready: the view still works */ }
  })

  // `layout.browse`: blocks a theme places in the side column, under the categories, resolved like
  // its Home blocks. shortcut: a tabbed block's roles resolve on AniList screens only (Browse loads no
  // Home rows to match them against elsewhere); pass the catalog's Home row ids if a theme needs more.
  const themeBlocks = $derived.by(() => {
    const entries = ($activeThemeLayout as (ThemeLayout & { browse?: ThemeLayoutEntry[] }) | null)?.browse?.filter((entry) => 'block' in entry)
    return entries?.length ? resolveThemeHome(entries, selection, []) : null
  })
  const column = $derived(!$isMobile)
  const side = $derived(column && (genres.length > 0 || !!themeBlocks?.rows.length))
  const variant = $derived(isLegacyAniListCatalog(selection) ? 'anilist' : isSourceSelection(selection) ? 'source' : 'catalog')
  const skeletons = Array.from({ length: 12 })
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Browse is unavailable offline" subtitle="Browsing needs a connection. Your downloaded titles are available on the Downloads page." />
{:else}
<div data-slot="browse" data-variant={variant}
     class="px-4 pb-20 pt-4 sm:px-8 sm:pt-8 {variant === 'anilist' && $anilistDegradedBannerVisible ? 'pt-[2.75rem] sm:pt-[3.75rem]' : ''}">
  <div class="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
    <h1 data-part="browse.title" class="text-2xl font-black">Browse</h1>
    {#if sorts.length}
      <BrowseSorts options={sorts} active={activeSort} onSelect={(value) => choose({ sort: value })} />
    {/if}
  </div>
  {#if !column && genres.length}
    <div class="mb-4"><BrowseCategories {genres} active={activeGenre} column={false} onSelect={(value) => choose({ genre: value })} /></div>
  {/if}

  <div class="flex items-start gap-6">
    {#if side}
      <!-- Its own d-pad region: Left from the grid's first column lands on the lit category, Right
           returns to the grid. It stays in view beside the grid and scrolls on its own. Theme blocks
           drop their page gutters here, as in Home's side column. -->
      <aside data-slot="browse.side" data-nav-region="browse-side" data-nav-scroll-container
             class="sticky top-[calc(var(--theme-shell-top,2rem)+1rem)] max-h-[calc(100vh-var(--theme-shell-top,2rem)-2rem)] w-52 shrink-0 space-y-6 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&_[data-block]]:px-0">
        {#if genres.length}
          <BrowseCategories {genres} active={activeGenre} column onSelect={(value) => choose({ genre: value })} />
        {/if}
        {#if themeBlocks}
          {#each themeBlocks.rows as id (id)}<HomeBlockView {id} target={selection} block={themeBlocks.blocks[id]} />{/each}
        {/if}
      </aside>
    {/if}

    <section bind:this={results} class="min-w-0 flex-1" aria-busy={loading}>
      {#if catalogError || (error && !feed?.media.length)}
        <div data-part="browse.empty" data-state="error" class="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p class="text-sm">{catalogError || error}</p>
          <button type="button" data-focusable onclick={() => (catalogError ? catalogAttempt++ : retry())}
                  class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
        </div>
      {:else if catalog && !sorts.length}
        <div data-part="browse.empty" data-state="empty" class="rounded-xl bg-secondary/40 p-8 text-center text-muted-foreground">This catalog has nothing to browse. Search it instead.</div>
      {:else if feed?.media.length}
        {#key key}
          <!-- global: it also fades in after the skeletons, not only on a switch between listings. -->
          <div in:fade|global={{ duration: $gameMode ? 0 : 150 }}>
            <VirtualGrid
              part="browse.grid"
              variant="grid"
              items={feed.media}
              getKey={mediaKey}
              className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-5"
              onEndReached={loadAtEnd}
            >
              {#snippet children(item)}<SmallCard media={item} fill reserveTitleLines />{/snippet}
            </VirtualGrid>
          </div>
        {/key}
        {#if loading}
          <p data-part="browse.more" class="mt-6 text-center text-sm text-muted-foreground">Loading more…</p>
        {:else if error}
          <div data-part="browse.more" data-state="error" class="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            Couldn't load more: {error}
            <button type="button" data-focusable onclick={retry} class="rounded-md bg-secondary px-3 py-1.5 font-bold text-foreground">Retry</button>
          </div>
        {/if}
      {:else if feed && !loading}
        <div data-part="browse.empty" data-state="empty" class="rounded-xl bg-secondary/40 p-8 text-center text-muted-foreground">
          Nothing here yet.
          {#if activeGenre}
            <button type="button" data-focusable onclick={() => choose({ genre: '' })} class="mt-3 block w-full font-bold text-foreground underline">Show all categories</button>
          {/if}
        </div>
      {:else}
        <div data-part="browse.grid" data-variant="grid" data-state="loading" aria-hidden="true"
             class="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-5">
          {#each skeletons as _}<div class="aspect-[2/3] w-full rounded-md skeloader"></div>{/each}
        </div>
      {/if}
    </section>
  </div>
</div>
{/if}
