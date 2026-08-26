<script lang="ts">
  import { goto } from '$app/navigation'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import type { CatalogHome } from '$lib/catalog/types'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import { catalogProvider } from '$lib/settings/catalog'
  import { mediaHref } from '$lib/anilist/media'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'

  let home = $state<CatalogHome | null>(null)
  let loading = $state(true)
  let error = $state('')
  let retry = $state(0)
  const listUser = $derived($anilistUserName || $anilistUser)

  $effect(() => {
    const selection = $catalogProvider
    void retry
    if (selection === 'auto' || selection === 'anilist') return
    const abort = new AbortController()
    loading = true
    error = ''
    home = null
    void loadCatalogProvider(selection).then((provider) => provider.home(abort.signal)).then((result) => {
      if (!abort.signal.aborted) home = result
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
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
    return `/app/search?${params}`
  }
</script>

<div class="pb-16">
  {#if home?.hero.length}
    <Hero medias={home.hero} onplay={(media) => goto(mediaHref(media))} oninfo={(media) => goto(mediaHref(media))} />
  {:else if loading}
    <div class="relative mb-6 h-[50vh] overflow-hidden bg-muted">
      <div class="absolute inset-0 skeloader"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
    </div>
  {/if}

  <div class="space-y-5">
    {#key listUser}<ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />{/key}

    {#if error}
      <div class="mx-4 rounded-xl border border-destructive/30 bg-destructive/10 p-5 sm:mx-8">
        <h2 class="font-black">Couldn’t load {$catalogProvider === 'stremio' ? 'Stremio metadata' : $catalogProvider.toUpperCase()}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{error}</p>
        <button data-focusable onclick={() => retry++} class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
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
      {#each home.sections as section (section.id)}
        <Carousel title={section.title} viewMoreHref={section.more ? moreHref(section.more) : undefined}>
          {#each section.media as media (media.catalog?.id ?? media.id)}
            <div class="load-in shrink-0"><SmallCard {media} /></div>
          {/each}
        </Carousel>
      {/each}
      {#if !home.sections.length && !error}
        <div class="mx-4 rounded-xl bg-secondary/50 p-6 text-center text-sm text-muted-foreground sm:mx-8">This provider returned no browseable catalogs.</div>
      {/if}
    {/if}
  </div>
</div>
