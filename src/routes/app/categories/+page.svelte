<script lang="ts">
  // Categories: the active catalog's categories as a wall of chips, each opening Browse narrowed to
  // it. A source that gives its categories artwork shows the focused one's behind the wall, faded in
  // from script in Game mode (a CSS fade blinks as it ends on WebKitGTK).
  import { getContextClient } from '@urql/svelte'
  import Spinner from '$lib/components/Spinner.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { browseSearch } from '$lib/catalog/browse'
  import { cachedBrowseCatalog, loadBrowseCatalog, type BrowseCatalog } from '$lib/catalog/browse-fetch'
  import { motion } from '$lib/motion/gm-motion'
  import { focusOnMount } from '$lib/nav'
  import { catalogProvider } from '$lib/settings/catalog'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'

  heroMedia.set(null)
  const client = getContextClient()

  let loaded = $state.raw<{ for: string; catalog: BrowseCatalog } | null>(null)
  let error = $state('')
  let attempt = $state(0)
  const catalog = $derived(loaded?.for === $catalogProvider ? loaded.catalog : null)
  $effect(() => {
    const target = $catalogProvider
    void attempt
    error = ''
    const cached = cachedBrowseCatalog(target)
    if (cached) { loaded = { for: target, catalog: cached }; return }
    let live = true
    loadBrowseCatalog(target, client)
      .then((value) => { if (live) loaded = { for: target, catalog: value } })
      .catch((reason) => { if (live) error = reason instanceof Error ? reason.message : String(reason) })
    return () => { live = false }
  })

  // A source's categories belong to each of its listings: the first (Popular) is the one Browse opens on.
  const sort = $derived(catalog?.sorts[0]?.value ?? '')
  const genres = $derived(catalog ? [...new Set(catalog.genres(sort).filter(Boolean))] : [])
  const href = (genre: string) => `/app/browse${browseSearch(sort, genre, sort)}`
  let backdrop = $state('')
  const skeletons = Array.from({ length: 12 })
  // The first chip takes focus as the page opens with a pad, like a series page lands on Play.
  const focusOnMountIf = (node: HTMLElement, on: boolean) => { if (on) focusOnMount(node) }
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Categories are unavailable offline" subtitle="Browsing needs a connection. Your downloaded titles are available on the Downloads page." />
{:else}
<div data-slot="categories" class="relative min-h-screen px-4 pb-20 pt-4 sm:px-8 sm:pt-8">
  {#if backdrop}
    {#key backdrop}
      <img data-part="categories.backdrop" src={backdrop} alt="" draggable="false"
           in:motion={{ opacity: [0, 1], duration: 450 }} out:motion={{ opacity: [0, 1], duration: 450 }}
           class="pointer-events-none fixed inset-0 h-full w-full object-cover" />
    {/key}
    <div data-part="categories.scrim" aria-hidden="true" class="pointer-events-none fixed inset-0 bg-gradient-to-b from-background via-background/40 to-background/80"></div>
  {/if}
  <h1 data-part="categories.title" class="relative mb-6 text-2xl font-black sm:text-3xl">Categories</h1>
  {#if error}
    <div data-part="categories.empty" data-state="error" class="relative flex flex-col items-start gap-3 text-sm text-muted-foreground">
      <p>{error}</p>
      <button type="button" data-focusable use:focusOnMount onclick={() => attempt++} class="rounded-lg bg-secondary px-4 py-2 font-bold text-foreground hover:bg-accent">Try again</button>
    </div>
  {:else if !catalog}
    <div data-part="categories.chips" data-state="loading" aria-busy="true" class="relative flex flex-wrap gap-3">
      {#each skeletons as _, index (index)}<div class="h-11 w-32 rounded-full skeloader"></div>{/each}
      <span class="sr-only"><Spinner size="xs" inline /> Loading categories</span>
    </div>
  {:else if !genres.length}
    <p data-part="categories.empty" data-state="empty" class="relative text-sm text-muted-foreground">This catalog has no categories.</p>
  {:else}
    <div data-part="categories.chips" role="list" class="relative flex flex-wrap gap-3">
      {#each genres as genre, index (genre)}
        <a role="listitem" data-part="categories.chip" data-focusable href={href(genre)}
           use:focusOnMountIf={index === 0}
           onfocus={() => { const image = catalog?.genreImage?.(genre); if (image) backdrop = image }}
           class="rounded-full bg-secondary/90 px-5 py-2.5 text-sm font-bold text-foreground/85 outline-none backdrop-blur-sm hover:bg-accent focus-visible:bg-primary focus-visible:text-primary-foreground">{genre}</a>
      {/each}
    </div>
  {/if}
</div>
{/if}
