<script lang="ts">
  import { goto } from '$app/navigation'
  import Hero from '$lib/components/banner/Hero.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import PersonalizedRow from '$lib/components/cards/PersonalizedRow.svelte'
  import RecentReleaseRow from '$lib/components/cards/RecentReleaseRow.svelte'
  import CatalogSectionRow from './CatalogSectionRow.svelte'
  import HomeRowFrame from './HomeRowFrame.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { mediaHref } from '$lib/anilist/media'
  import { homeSections } from '$lib/anilist/queries'
  import type { Media } from '$lib/anilist/types'
  import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
  import {
    decodeMergedCatalogHomeRowId,
    loadCatalogProvider,
    mergedCatalogHomeRowOptions,
  } from '$lib/catalog/registry'
  import { CatalogConfigurationError, type CatalogHome, type CatalogHomeRowOption } from '$lib/catalog/types'
  import {
    catalogLabel,
    catalogProviders,
    mergedCatalogProviders,
    type CatalogSelection,
  } from '$lib/settings/catalog'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'

  type ExternalCatalogSelection = Exclude<CatalogSelection, 'auto' | 'anilist'>

  let { anilistHero = [] }: { anilistHero?: Media[] } = $props()

  let options = $state<Awaited<ReturnType<typeof mergedCatalogHomeRowOptions>>>([])
  // Catalog homes are immutable snapshots. A raw root preserves Media identity between the first
  // usable Aniyomi update and its final result instead of recursively proxying every card.
  let homes = $state.raw<Partial<Record<CatalogSelection, CatalogHome>>>({})
  let optionsLoading = $state(true)
  let homeLoading = $state(false)
  let errors = $state<Array<{ provider: CatalogSelection; message: string; configuration: boolean }>>([])
  const tmdbNeedsConfiguration = $derived(errors.some((error) => error.provider === 'tmdb' && error.configuration))
  const listUser = $derived($anilistUserName || $anilistUser)
  const anilistSections = homeSections(new Date())
  const anilistSectionMap = new Map(anilistSections.map((section) => [section.key, section]))
  const selections = $derived(mergedCatalogProviders($catalogProviders))
  const hasAniList = $derived(selections.includes('auto') || selections.includes('anilist'))
  const rows = $derived(resolveCatalogHomeRows('merged', options, $catalogHomeLayouts).filter((row) => row.enabled))
  const visibleRowIds = $derived(rows.map((row) => row.id))
  const optionsKey = $derived(JSON.stringify(selections))
  const externalRequestKey = $derived(JSON.stringify(rows.flatMap((row) => {
    const decoded = decodeMergedCatalogHomeRowId(row.id)
    return decoded && decoded.selection !== 'auto' && decoded.selection !== 'anilist' ? [row.id] : []
  })))

  $effect(() => {
    void optionsKey
    const abort = new AbortController()
    optionsLoading = true
    void mergedCatalogHomeRowOptions(selections, abort.signal).then((result) => {
      if (!abort.signal.aborted) options = result
    }).finally(() => {
      if (!abort.signal.aborted) optionsLoading = false
    })
    return () => abort.abort()
  })

  $effect(() => {
    void externalRequestKey
    const requested = new Map<ExternalCatalogSelection, string[]>()
    for (const row of rows) {
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
    return (withLandscapeArt.length ? withLandscapeArt : candidates).slice(0, 10)
  })

  function moreHref(selection: CatalogSelection, more?: CatalogHome['sections'][number]['more']): string | undefined {
    if (!more) return undefined
    const params = new URLSearchParams({ provider: selection })
    if (more.query) params.set('search', more.query)
    if (more.type && more.type !== 'all') params.set('type', more.type)
    if (more.genre) params.set('genre', more.genre)
    if (more.year) params.set('year', String(more.year))
    if (more.sort) params.set('sort', more.sort)
    if (more.sourceId) params.set('source', more.sourceId)
    return `/app/search?${params}`
  }

  function editorTitle(row: CatalogHomeRowOption): string {
    if (row.id === 'continue') return row.title
    const decoded = decodeMergedCatalogHomeRowId(row.id)
    return decoded ? `${row.title} · ${catalogLabel(decoded.selection)}` : row.title
  }
</script>

<div class="pb-16">
  {#if hero.length}
    <Hero medias={hero} onplay={(media) => goto(mediaHref(media))} oninfo={(media) => goto(mediaHref(media))} />
  {:else if optionsLoading || homeLoading}
    <div class="relative mb-6 h-[50vh] overflow-hidden bg-muted">
      <div class="absolute inset-0 skeloader"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
    </div>
  {/if}

  <div class="space-y-5">
    {#each rows as row (row.id)}
      <HomeRowFrame rowId={row.id} title={editorTitle(row)} target="merged" visibleIds={visibleRowIds}>
        {#if row.id === 'continue'}
          {#key listUser}<ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} catalogScope="all" />{/key}
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
    {/each}

    {#if optionsLoading || (homeLoading && !rows.length)}
      {#each Array.from({ length: 3 }) as _}
        <div class="px-4 sm:px-8">
          <div class="mb-3 h-5 w-44 rounded skeloader"></div>
          <div class="flex gap-3 overflow-hidden">{#each Array.from({ length: 8 }) as _}<div class="aspect-[2/3] w-36 shrink-0 rounded-md skeloader sm:w-[152px]"></div>{/each}</div>
        </div>
      {/each}
    {/if}

    {#if errors.length}
      <div class="mx-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm sm:mx-8">
        <p class="font-black">Some catalogs couldn’t load</p>
        <p class="mt-1 text-muted-foreground">{errors.map((error) => catalogLabel(error.provider)).join(', ')} can be retried by refreshing Home.</p>
        {#if tmdbNeedsConfiguration}
          <a href="/app/settings/catalog" data-focusable class="mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 font-bold text-primary-foreground">Add TMDB token</a>
        {/if}
      </div>
    {/if}
  </div>
</div>
