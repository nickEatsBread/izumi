<script module lang="ts">
  import type { CatalogHome as CatalogHomeData } from '$lib/catalog/types'

  const HOME_CACHE_MS = 5 * 60_000
  const providerHomeCache = new Map<string, { storedAt: number; home: CatalogHomeData; complete: boolean }>()
</script>

<script lang="ts">
  import { goto } from '$app/navigation'
  import Hero from '$lib/components/banner/Hero.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import CatalogSectionRow from './CatalogSectionRow.svelte'
  import HomeRowFrame from './HomeRowFrame.svelte'
  import { CatalogConfigurationError, type CatalogHome, type CatalogHomeSection } from '$lib/catalog/types'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import { catalogProvider, jvmCatalogSourceOverrides, stremioHeroArtwork } from '$lib/settings/catalog'
  import { catalogHomeLayoutKey, catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
  import { CONTINUE_HOME_ROW } from '$lib/catalog/home-options'
  import { tmdbCustomHomeRows } from '$lib/catalog/tmdb-custom-rows'
  import { mediaHref } from '$lib/anilist/media'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'

  // Provider payloads are immutable snapshots. Deep-proxying every Media object gives Svelte's
  // keyed carousels a fresh proxy identity on every progressive update; in dev builds the sixth
  // replacement triggers an extremely expensive stack capture for every card. Keep the snapshot
  // reactive only at its root so unchanged Media references remain unchanged across updates.
  let home = $state.raw<CatalogHome | null>(null)
  let loading = $state(true)
  let error = $state('')
  let tmdbNeedsConfiguration = $state(false)
  let retry = $state(0)
  const listUser = $derived($anilistUserName || $anilistUser)
  type ContentRow = { id: string; kind: 'continue' } | { id: string; kind: 'section'; section: CatalogHomeSection }
  const continueEnabled = $derived(resolveCatalogHomeRows($catalogProvider, [CONTINUE_HOME_ROW], $catalogHomeLayouts)[0]?.enabled ?? true)
  const contentRows = $derived.by((): ContentRow[] => {
    if (!home) return []
    const sections = new Map(home.sections.map((section) => [section.id, section]))
    const options = [CONTINUE_HOME_ROW, ...home.sections.map((section) => ({ id: section.id, title: section.title }))]
    const result: ContentRow[] = []
    for (const row of resolveCatalogHomeRows($catalogProvider, options, $catalogHomeLayouts)) {
      if (!row.enabled) continue
      if (row.id === 'continue') result.push({ id: row.id, kind: 'continue' })
      else if (sections.has(row.id)) result.push({ id: row.id, kind: 'section', section: sections.get(row.id)! })
    }
    return result
  })
  const visibleRowIds = $derived(contentRows.map((row) => row.id))

  $effect(() => {
    const selection = $catalogProvider
    void retry
    if (selection === 'auto' || selection === 'anilist') return
    const abort = new AbortController()
    // A provider's visible rows are part of the request, not merely presentation. Include them in
    // the cache identity so enabling an Aniyomi source or restoring a hidden Home row cannot reuse
    // an older one-source snapshot that was previously considered complete.
    const cacheKey = JSON.stringify([
      selection,
      $catalogHomeLayouts[catalogHomeLayoutKey(selection)] ?? null,
      selection === 'jvm' ? $jvmCatalogSourceOverrides : null,
      selection === 'tmdb' ? $tmdbCustomHomeRows : null,
    ])
    const cached = providerHomeCache.get(cacheKey)
    // Keep this local: reading reactive `home` inside its own loading effect subscribes the effect
    // to every progressive result it writes later. Each first Aniyomi row then aborted and restarted
    // the whole provider load, hammering getPopular in a feedback loop and freezing the renderer.
    const initialHome = cached && Date.now() - cached.storedAt < HOME_CACHE_MS ? cached.home : null
    home = initialHome
    loading = !initialHome
    error = ''
    tmdbNeedsConfiguration = false
    if (cached?.complete && initialHome) return
    const publish = (result: CatalogHome, complete = false) => {
      if (abort.signal.aborted) return
      home = result
      providerHomeCache.set(cacheKey, { storedAt: Date.now(), home: result, complete })
      if (result.hero.length || result.sections.length) loading = false
    }
    void loadCatalogProvider(selection).then((provider) => provider.home(abort.signal, undefined, publish)).then((result) => {
      publish(result, result.partial !== true)
    }).catch((reason) => {
      if (!abort.signal.aborted) {
        error = reason instanceof Error ? reason.message : String(reason)
        tmdbNeedsConfiguration = selection === 'tmdb' && reason instanceof CatalogConfigurationError
      }
    }).finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })

  function moreHref(more: NonNullable<CatalogHome['sections'][number]['more']>): string {
    const params = new URLSearchParams()
    if (more.query) params.set('search', more.query)
    if (more.type && more.type !== 'all') params.set('type', more.type)
    if (more.genre) params.set('genre', more.genre)
    if (more.year) params.set('year', String(more.year))
    if (more.sort) params.set('sort', more.sort)
    if (more.sourceId) params.set('source', more.sourceId)
    return `/app/search?${params}`
  }
</script>

<!-- The bounded Aniyomi loader now reconciles rows in two batches, so its placeholders can use the
     same loading shimmer as every other catalog without repeatedly remounting the card tree. -->
<div class="pb-16">
  {#if home?.hero.length}
    <Hero medias={home.hero} artworkMode={$catalogProvider === 'stremio' ? $stremioHeroArtwork : 'backdrop'}
      onplay={(media) => goto(mediaHref(media))} oninfo={(media) => goto(mediaHref(media))} />
  {:else if loading}
    <div class="relative mb-6 h-[50vh] overflow-hidden bg-muted">
      <div class="absolute inset-0 skeloader"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
    </div>
  {/if}

  <div class="space-y-5">
    {#if continueEnabled && !home}
      {#key listUser}<ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />{/key}
    {/if}

    {#if error}
      <div class="mx-4 rounded-xl border border-destructive/30 bg-destructive/10 p-5 sm:mx-8">
        <h2 class="font-black">Couldn’t load {$catalogProvider === 'stremio' ? 'Stremio metadata' : $catalogProvider === 'jvm' ? 'Aniyomi sources' : $catalogProvider.toUpperCase()}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{error}</p>
        {#if tmdbNeedsConfiguration}
          <a href="/app/settings/catalog" data-focusable class="mt-4 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Add TMDB token</a>
        {:else}
          <button data-focusable onclick={() => retry++} class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
        {/if}
      </div>
    {/if}

    {#if loading && !home}
      {#each Array.from({ length: 4 }) as _}
        <div class="px-4 sm:px-8">
          <div class="mb-3 h-5 w-40 rounded skeloader"></div>
          <div class="flex gap-3 overflow-hidden">{#each Array.from({ length: 8 }) as _}<div class="aspect-[2/3] w-36 shrink-0 rounded-md skeloader sm:w-[152px]"></div>{/each}</div>
        </div>
      {/each}
    {:else if home}
      {#each contentRows as row (row.id)}
        <HomeRowFrame rowId={row.id} title={row.kind === 'continue' ? 'Continue Watching' : row.section.title} target={$catalogProvider} visibleIds={visibleRowIds}>
          {#if row.kind === 'continue'}
            {#key listUser}<ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />{/key}
          {:else}
            {@const section = row.section}
            <CatalogSectionRow {section} viewMoreHref={section.more ? moreHref(section.more) : undefined}
              showCatalogSource={$catalogProvider !== 'jvm'} />
          {/if}
        </HomeRowFrame>
      {/each}
      {#if !contentRows.length && !error}
        <div class="mx-4 rounded-xl bg-secondary/50 p-6 text-center text-sm text-muted-foreground sm:mx-8">This provider returned no browseable catalogs.</div>
      {/if}
    {/if}
  </div>
</div>
