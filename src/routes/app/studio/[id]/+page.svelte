<script lang="ts">
  import { page } from '$app/state'
  import { getContextClient, queryStore } from '@urql/svelte'
  import { STUDIO_PROFILE_QUERY, type SearchFilters } from '$lib/anilist/detail-queries'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { offlineMode } from '$lib/stores/offline'
  import { heroMedia } from '$lib/stores/hero'
  import { showAdult } from '$lib/settings/ui'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import Building2 from '@lucide/svelte/icons/building-2'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Heart from '@lucide/svelte/icons/heart'

  heroMedia.set(null)
  const client = getContextClient()
  const id = $derived(Number(page.params.id))
  const filters = $derived<SearchFilters>({ studioId: id })
  const store = $derived(queryStore<{
    Studio?: {
      id: number
      name: string
      isAnimationStudio?: boolean
      siteUrl?: string
      favourites?: number
    } | null
  }>({
    client,
    query: STUDIO_PROFILE_QUERY,
    variables: { id },
    pause: $offlineMode || !Number.isFinite(id),
  }))
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Studio pages are unavailable offline" subtitle="Reconnect to browse this studio's anime credits." />
{:else}
  <main class="p-4 pb-16 sm:p-8">
    {#if $store.fetching}
      <div class="mb-8 flex items-center gap-4">
        <div class="skeloader size-20 rounded-2xl"></div>
        <div class="space-y-2"><div class="skeloader h-7 w-52 rounded"></div><div class="skeloader h-4 w-32 rounded"></div></div>
      </div>
    {:else if $store.error}
      <div class="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <h1 class="font-black">Couldn’t load this studio</h1>
        <p class="mt-1 text-sm text-muted-foreground">{$store.error.message}</p>
      </div>
    {:else if $store.data?.Studio}
      {@const studio = $store.data.Studio}
      <header class="mb-8 flex flex-wrap items-center gap-4">
        <div class="grid size-20 shrink-0 place-items-center rounded-2xl bg-theme/15 text-theme">
          <Building2 size={38} />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-black uppercase tracking-[0.18em] text-theme">{studio.isAnimationStudio === false ? 'Production company' : 'Animation studio'}</p>
          <h1 class="mt-1 text-3xl font-black">{studio.name}</h1>
          {#if studio.favourites}
            <p class="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Heart size={14} /> {studio.favourites.toLocaleString()} AniList favourites</p>
          {/if}
        </div>
        {#if studio.siteUrl}
          <button data-focusable type="button" onclick={() => void openUrl(studio.siteUrl!)}
            class="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
            AniList <ExternalLink size={15} />
          </button>
        {/if}
      </header>

      <section>
        <h2 class="mb-4 text-xl font-black">Anime</h2>
        {#key `${id}|${$showAdult}`}
          <SearchResults {filters} />
        {/key}
      </section>
    {:else}
      <p class="text-muted-foreground">Studio not found.</p>
    {/if}
  </main>
{/if}
