<script lang="ts">
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import Hero from '$lib/components/banner/Hero.svelte'
  import HeroPlaceholder from '$lib/components/banner/HeroPlaceholder.svelte'
  import MediaListSheet from '$lib/components/detail/MediaListSheet.svelte'
  import CollectionsHome from './CollectionsHome.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import PersonalizedRow from '$lib/components/cards/PersonalizedRow.svelte'
  import RecentReleaseRow from '$lib/components/cards/RecentReleaseRow.svelte'
  import CatalogSectionRow from './CatalogSectionRow.svelte'
  import HomeRowFrame from './HomeRowFrame.svelte'
  import HomeBlockView from '$lib/components/home/HomeBlockView.svelte'
  import HomeColumns from '$lib/components/home/HomeColumns.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { mediaHref } from '$lib/anilist/media'
  import { homeSections } from '$lib/anilist/queries'
  import type { Media } from '$lib/anilist/types'
  import { homeEditorOpen } from '$lib/catalog/home-editor'
  import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
  import {
    decodeMergedCatalogHomeRowId,
    homeRowOptions,
    loadCatalogProvider,
  } from '$lib/catalog/registry'
  import { homeCollections } from '$lib/catalog/collections/store'
  import { collectionIdOf, collectionRowOptions } from '$lib/catalog/collections/rows'
  import { CatalogConfigurationError, type CatalogHome, type CatalogHomeRowOption } from '$lib/catalog/types'
  import { tmdbCustomHomeRows } from '$lib/catalog/tmdb-custom-rows'
  import { activeThemeLayout } from '$lib/themes/layout-state'
  import { themePresentation } from '$lib/themes/runtime'
  import { isThemeBlockId, resolveThemeHome, themeHomeHas } from '$lib/home/theme-layout'
  import { blockRowOptions, blockTitle, splitHomeColumns } from '$lib/home/block-rows'
  import { homeAsideWidth, homeBlocks, isBlockId } from '$lib/home/blocks'
  import { isContentRow } from '$lib/home/row-source'
  import { isMobile } from '$lib/platform'
  import {
    catalogLabel,
    catalogProviders,
    isCustomScreen,
    isLegacyAniListCatalog,
    mergedCatalogProviders,
    type CatalogSelection,
    type CustomScreenId,
  } from '$lib/settings/catalog'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'

  type ExternalCatalogSelection = Exclude<CatalogSelection, 'auto' | 'anilist'>

  // Merged Home, or a custom screen: a named Merged screen with its own layout, whose sections all start off.
  let { target = 'merged', anilistHero = [] }: { target?: 'merged' | CustomScreenId; anilistHero?: Media[] } = $props()

  let options = $state<Awaited<ReturnType<typeof homeRowOptions>>>([])
  // Catalog homes are immutable snapshots. A raw root preserves Media identity between the first
  // usable Aniyomi update and its final result instead of recursively proxying every card.
  let homes = $state.raw<Partial<Record<CatalogSelection, CatalogHome>>>({})
  let optionsLoading = $state(true)
  // A theme hero template's `list` action opens the list editor for that slide's title.
  let listMedia = $state<Media | null>(null)
  let homeLoading = $state(false)
  let errors = $state<Array<{ provider: CatalogSelection; message: string; configuration: boolean }>>([])
  const tmdbNeedsConfiguration = $derived(errors.some((error) => error.provider === 'tmdb' && error.configuration))
  const listUser = $derived($anilistUserName || $anilistUser)
  const anilistSections = homeSections(new Date())
  const anilistSectionMap = new Map(anilistSections.map((section) => [section.key, section]))
  const selections = $derived(mergedCatalogProviders($catalogProviders))
  const collectionOptions = $derived(collectionRowOptions($homeCollections, target))
  const rows = $derived(resolveCatalogHomeRows(target, [...options, ...collectionOptions, ...blockRowOptions(target, $catalogHomeLayouts, $homeBlocks)], $catalogHomeLayouts).filter((row) => row.enabled))
  // A custom screen features AniList's banner only when it shows an AniList row; Merged whenever AniList is on.
  const hasAniList = $derived(isCustomScreen(target)
    ? rows.some((row) => { const decoded = decodeMergedCatalogHomeRowId(row.id); return !!decoded && isLegacyAniListCatalog(decoded.selection) })
    : selections.some(isLegacyAniListCatalog))
  const optionIds = $derived(options.map((option) => option.id))
  // While a theme layout is active, it replaces the row order below (the user's own layout, in
  // `catalogHomeLayouts`, is never written to); its ephemeral `theme:<n>` blocks join `$homeBlocks`
  // for lookups so a theme block renders exactly like a real one.
  // The theme was drawn for AniList's rows: the catalog rows it left out follow its own.
  const themeHome = $derived($activeThemeLayout?.home ? resolveThemeHome($activeThemeLayout.home, target, optionIds, rows.map((row) => row.id).filter(isContentRow)) : null)
  const allBlocks = $derived(themeHome ? { ...$homeBlocks, ...themeHome.blocks } : $homeBlocks)
  // A theme layout places only catalog rows, so this Home's collections keep their place after the banner.
  const themeCollectionIds = $derived(themeHome ? rows.flatMap((row) => collectionIdOf(row.id) ?? []) : [])
  const visibleRowIds = $derived(themeHome?.rows ?? rows.map((row) => row.id))
  // The hero renders full-bleed above HomeColumns only while it truly leads the row order; while
  // Edit Home is open it always flows through HomeColumns instead, so it can be dragged/hidden like
  // any other row (it would otherwise have no frame to grab while sitting in the unwrapped top slot).
  const heroFirst = $derived(!$homeEditorOpen && visibleRowIds[0] === 'hero')
  const homeRowIds = $derived(heroFirst ? visibleRowIds.slice(1) : visibleRowIds)
  // While Edit Home is open, phones must still show every block (including a side-column one that
  // opted out of `phone`), or there would be no way to reach its settings/remove button on a phone.
  const columns = $derived(splitHomeColumns(homeRowIds, allBlocks, $isMobile && !$homeEditorOpen))
  const optionsKey = $derived(JSON.stringify([selections, $tmdbCustomHomeRows]))
  const externalRequestKey = $derived(JSON.stringify(rows.flatMap((row) => {
    const decoded = decodeMergedCatalogHomeRowId(row.id)
    return decoded && decoded.selection !== 'auto' && decoded.selection !== 'anilist' ? [row.id] : []
  })))

  $effect(() => {
    void optionsKey
    const abort = new AbortController()
    optionsLoading = true
    void homeRowOptions(target, selections, abort.signal).then((result) => {
      if (!abort.signal.aborted) options = result
    }).finally(() => {
      if (!abort.signal.aborted) optionsLoading = false
    })
    return () => abort.abort()
  })

  $effect(() => {
    void externalRequestKey
    const requested = new Map<ExternalCatalogSelection, string[]>()
    // `rows` also changes on a purely local block edit ($homeBlocks), which would otherwise clear
    // `homes` and refetch every provider. The effect already keys on `externalRequestKey`'s VALUE
    // (a string derived from `rows`), so reading `rows` itself must stay untracked here.
    for (const row of untrack(() => rows)) {
      const decoded = decodeMergedCatalogHomeRowId(row.id)
      if (!decoded || decoded.selection === 'auto' || decoded.selection === 'anilist') continue
      const selection: ExternalCatalogSelection = decoded.selection
      requested.set(selection, [...(requested.get(selection) ?? []), decoded.rowId])
    }
    const abort = new AbortController()
    homes = {}
    errors = []
    homeLoading = false
    if (!requested.size) return () => abort.abort()
    homeLoading = true
    void Promise.all([...requested].map(async ([selection, rowIds]) => {
      try {
        const provider = await loadCatalogProvider(selection)
        const publish = (home: CatalogHome) => {
          if (!abort.signal.aborted) homes = { ...homes, [selection]: home }
        }
        const home = await provider.home(abort.signal, rowIds, publish)
        if (!abort.signal.aborted) homes = { ...homes, [selection]: home }
      } catch (reason) {
        if (!abort.signal.aborted) errors = [...errors, {
          provider: selection,
          message: reason instanceof Error ? reason.message : String(reason),
          configuration: reason instanceof CatalogConfigurationError,
        }]
      }
    })).finally(() => {
      if (!abort.signal.aborted) homeLoading = false
    })
    return () => abort.abort()
  })

  const hero = $derived.by(() => {
    if (hasAniList && anilistHero.length) return anilistHero
    const candidates = selections.flatMap((selection) => homes[selection]?.hero ?? [])
    const withLandscapeArt = candidates.filter((media) => media.bannerImage || media.trailer?.id)
    // A theme's `hero.limit` (API 4) caps the slides here too; the AniList pool arrives capped.
    return (withLandscapeArt.length ? withLandscapeArt : candidates).slice(0, $themePresentation?.hero?.limit ?? 10)
  })

  function moreHref(selection: CatalogSelection, more?: CatalogHome['sections'][number]['more']): string | undefined {
    if (!more) return undefined
    const params = new URLSearchParams({ provider: selection })
    if (more.query) params.set('search', more.query)
    if (more.type && more.type !== 'all') params.set('type', more.type)
    if (more.genre) params.set('genre', more.genre)
    if (more.year) params.set('year', String(more.year))
    if (more.sort) params.set('sort', more.sort)
    if (more.minScore) params.set('minScore', String(more.minScore))
    if (more.maxScore != null) params.set('maxScore', String(more.maxScore))
    if (more.minVotes) params.set('votes', String(more.minVotes))
    if (more.language) params.set('language', more.language)
    if (more.country) params.set('country', more.country)
    if (more.sourceId) params.set('source', more.sourceId)
    return `/app/search?${params}`
  }

  function editorTitle(row: CatalogHomeRowOption): string {
    if (row.id === 'continue') return row.title
    const decoded = decodeMergedCatalogHomeRowId(row.id)
    return decoded ? `${row.title} · ${catalogLabel(decoded.selection)}` : row.title
  }
</script>

<div data-slot="home" data-variant="merged" class="pb-16">
  {#snippet heroBlock()}
    {#if hero.length}
      <Hero medias={hero} onplay={(media) => goto(mediaHref(media))} oninfo={(media) => goto(mediaHref(media))} onlist={(media) => (listMedia = media)} />
    {:else if (optionsLoading || homeLoading) && !$themePresentation?.hero?.hidden}
      <HeroPlaceholder />
    {/if}
  {/snippet}

  <!-- Row order is unknown before the row library loads (`rows` is empty pre-load), so the pre-load
       skeleton renders here rather than waiting on heroFirst, unless a theme layout opens on something else. -->
  {#if (optionsLoading && (themeHomeHas($activeThemeLayout?.home, 'hero', true) ?? true)) || heroFirst}{@render heroBlock()}{/if}

  <div class="space-y-5">
    {#if themeHome}<CollectionsHome ids={themeCollectionIds} />{/if}
    {#snippet mergedRow(id: string)}
      {@const row = rows.find((item) => item.id === id) ?? (isThemeBlockId(id) ? { id, title: blockTitle(allBlocks[id]) } : options.find((item) => item.id === id))}
      {@const visibleIds = columns.main.includes(id) ? columns.main : columns.aside}
      {#if row}
        <HomeRowFrame rowId={row.id} title={editorTitle(row)} {target} {visibleIds} locked={!!themeHome} role={themeHome?.roles[row.id]}>
          {#if row.id === 'hero'}
            {@render heroBlock()}
          {:else if row.id === 'continue'}
            {#key listUser}<ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} catalogScope="all" />{/key}
          {:else if collectionIdOf(row.id)}
            <CollectionsHome ids={[collectionIdOf(row.id) ?? '']} />
          {:else if isBlockId(row.id) || isThemeBlockId(row.id)}
            <HomeBlockView id={row.id} {target} {optionIds} block={allBlocks[row.id]} />
          {:else}
            {@const decoded = decodeMergedCatalogHomeRowId(row.id)}
            {#if decoded?.selection === 'auto' || decoded?.selection === 'anilist'}
              {#if decoded.rowId === 'recent'}
                <RecentReleaseRow />
              {:else if decoded.rowId === 'list'}
                {#if listUser}{#key listUser}<ListRow title="Your List · AniList" userName={listUser} status="PLANNING" preferLinkedRating={decoded.selection === 'auto'} />{/key}{/if}
                {#if $malToken || $malUser}<MalListRow title="Your List · MyAnimeList" status="plan_to_watch" preferLinkedRating={decoded.selection === 'auto'} />{/if}
              {:else if decoded.rowId === 'recommendations'}
                {#if listUser}{#key listUser}<PersonalizedRow userName={listUser} preferLinkedRating={decoded.selection === 'auto'} />{/key}{/if}
              {:else}
                {@const section = anilistSectionMap.get(decoded.rowId)}
                {#if section}<HomeRow title={`${section.title} · AniList`} vars={section.vars} preferLinkedRating={decoded.selection === 'auto'} />{/if}
              {/if}
            {:else if decoded}
              {@const section = homes[decoded.selection]?.sections.find((item) => item.id === decoded.rowId)}
              {#if section}
                <CatalogSectionRow {section} title={`${row.title} · ${catalogLabel(decoded.selection)}`}
                  viewMoreHref={moreHref(decoded.selection, section.more)} />
              {/if}
            {/if}
          {/if}
        </HomeRowFrame>
      {/if}
    {/snippet}
    <HomeColumns main={columns.main} aside={columns.aside} asideWidth={$activeThemeLayout?.asideWidth ?? $homeAsideWidth} asideGap={$activeThemeLayout?.asideGap} asideStart={$activeThemeLayout?.asideStart} stack="space-y-5" row={mergedRow} />

    {#if optionsLoading || (homeLoading && !rows.length)}
      {#each Array.from({ length: 3 }) as _}
        <div class="px-4 sm:px-8">
          <div class="mb-3 h-5 w-44 rounded skeloader"></div>
          <div class="flex gap-3 overflow-hidden">{#each Array.from({ length: 8 }) as _}<div data-part="row.skeleton" class="aspect-[2/3] w-36 shrink-0 rounded-md skeloader sm:w-[152px]"></div>{/each}</div>
        </div>
      {/each}
    {/if}

    {#if errors.length}
      <div class="mx-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm sm:mx-8">
        <p class="font-black">Some catalogs couldn’t load</p>
        <p class="mt-1 text-muted-foreground">{errors.map((error) => catalogLabel(error.provider)).join(', ')} can be retried by refreshing Home.</p>
        {#if tmdbNeedsConfiguration}
          <a href="/app/settings/library" data-focusable class="mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 font-bold text-primary-foreground">Add TMDB token</a>
        {/if}
      </div>
    {/if}
  </div>
</div>
{#if listMedia}<MediaListSheet media={listMedia} onclose={() => (listMedia = null)} />{/if}
