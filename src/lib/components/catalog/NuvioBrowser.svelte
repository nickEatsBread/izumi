<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { nuvioSession } from '$lib/nuvio/auth'
  import { nuvioApi, type BrowseOptions, type NuvioItem, type NuvioProfile } from '$lib/nuvio/api'
  import { homeCollections } from '$lib/catalog/collections/store'
  import { collectionFolderHref, type CollectionImport, type HomeCollection } from '$lib/catalog/collections/model'
  import { installCollectionImport } from '$lib/catalog/collections/install'
  import { enabledAddonUrls, normalizeBase } from '$lib/stremio/sources'
  import NuvioConnection from './NuvioConnection.svelte'
  import NuvioAccount from './NuvioAccount.svelte'
  import NuvioArtwork from './NuvioArtwork.svelte'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import Folder from '@lucide/svelte/icons/folder'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'

  let { initialTab = 'community', targetCollection = '', targetFolder = '' }: { initialTab?: string; targetCollection?: string; targetFolder?: string } = $props()
  let tab = $state('community')
  let search = $state(''), query = $state('')
  let sort = $state<BrowseOptions['sort']>('popular')
  let type = $state<BrowseOptions['type']>('all')
  let orientation = $state<BrowseOptions['orientation']>('all'), format = $state<BrowseOptions['format']>('all')
  let items = $state.raw<NuvioItem[]>([]), mine = $state.raw<HomeCollection[]>([]), profiles = $state.raw<NuvioProfile[]>([])
  let profileId = $state(0), pageNumber = $state(1), hasNext = $state(false)
  let loading = $state(false), error = $state(''), notice = $state(''), noticeHref = $state('')
  let selected = $state<NuvioItem | null>(null), preview = $state.raw<CollectionImport | null>(null)
  let detailLoading = $state(false), detailError = $state(''), saving = $state(false), selectedAddons = $state<number[]>([])
  let findingSources = $state(false), sourceNotice = $state('')
  let coverCollection = $state(''), coverFolder = $state(''), coverUse = $state<'cover' | 'focus'>('cover')
  let dialog: HTMLDialogElement
  let listAbort: AbortController | undefined, detailAbort: AbortController | undefined
  const visibleMine = $derived(mine.filter((collection) => collection.title.toLowerCase().includes(query.toLowerCase())))
  const coverFolders = $derived($homeCollections.find((collection) => collection.id === coverCollection)?.folders ?? [])
  const sourceProviders = $derived([...new Set(preview?.collections.flatMap((collection) => collection.folders.flatMap((folder) => folder.sources.map((source) => source.provider))) ?? [])])
  const alreadyAdded = $derived(!!preview?.collections.length && preview.collections.every((collection) => $homeCollections.some((existing) => existing.id === collection.id)))
  const requiredIds = $derived([...new Set(preview?.collections.flatMap((collection) => collection.folders.flatMap((folder) => folder.sources.filter((source) => source.provider === 'addon').map((source) => source.addonId!))) ?? [])])
  const missingManifests = $derived(requiredIds.filter((id) => !preview?.requirements.some((requirement) => requirement.addonId === id && requirement.manifestUrl)))
  const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
  const installed = (id: string) => $homeCollections.some((collection) => collection.nuvioOrigin === `community:${id}`)
  $effect(() => { tab = initialTab === 'covers' || initialTab === 'mine' ? initialTab : 'community' })
  $effect(() => { const value = search; const timer = setTimeout(() => query = value.trim(), 350); return () => clearTimeout(timer) })
  $effect(() => {
    const account = $nuvioSession?.userId
    untrack(() => {
      listAbort?.abort(); detailAbort?.abort(); dialog?.close(); items = []; mine = []; profiles = []; profileId = 0; error = ''; notice = ''
      if (!account) loading = false
    })
  })
  $effect(() => {
    const account = $nuvioSession?.userId
    const options = { page: 1, search: query, sort, type, orientation, format }
    const view = tab, profile = profileId
    if (account && view !== 'mine') untrack(() => { void load(view, options, profile, account) })
    return () => listAbort?.abort()
  })
  $effect(() => {
    if (selected && dialog && !dialog.open) dialog.showModal()
  })
  onDestroy(() => { listAbort?.abort(); detailAbort?.abort() })

  async function load(view = tab, options: BrowseOptions = { page: 1, search: query, sort, type, orientation, format }, profile = profileId, account = $nuvioSession?.userId) {
    if (!account) return
    listAbort?.abort()
    const abort = listAbort = new AbortController()
    loading = true; error = ''
    if (options.page === 1) { items = []; hasNext = false }
    try {
      if (view === 'mine') {
        if (!profiles.length) {
          const result = await nuvioApi.profiles(abort.signal)
          if (abort.signal.aborted) return
          profiles = result; profileId = result[0].id
          return
        }
        const chosen = profiles.find((row) => row.id === profile)
        if (!chosen) return
        mine = []
        const result = await nuvioApi.profileCollections(chosen, account, abort.signal)
        if (!abort.signal.aborted) mine = result
      } else {
        const result = await nuvioApi.browse(view === 'covers' ? 'cover' : 'collection', options, abort.signal)
        if (abort.signal.aborted) return
        items = options.page === 1 ? result.items : [...new Map([...items, ...result.items].map((item) => [item.id, item])).values()]
        pageNumber = options.page; hasNext = result.hasNext
      }
    } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not load Nuvio.' }
    finally { if (!abort.signal.aborted) loading = false }
  }
  async function inspect(item: NuvioItem, collection?: HomeCollection) {
    detailAbort?.abort()
    const abort = detailAbort = new AbortController()
    selected = item; preview = null; detailError = ''; selectedAddons = []; coverUse = 'cover'; saving = false; findingSources = false; sourceNotice = ''
    coverCollection = targetCollection || $homeCollections[0]?.id || ''
    coverFolder = targetFolder || $homeCollections.find((row) => row.id === coverCollection)?.folders[0]?.id || ''
    if (item.kind === 'cover') return
    detailLoading = true
    try {
      const result = collection ? { collections: [collection], requirements: [] } : await nuvioApi.community(item.id, abort.signal)
      if (!abort.signal.aborted) preview = result
    } catch (reason) { if (!abort.signal.aborted) detailError = reason instanceof Error ? reason.message : 'Could not load this collection.' }
    finally { if (!abort.signal.aborted) detailLoading = false }
  }
  function close() { detailAbort?.abort(); selected = null; preview = null; detailError = ''; saving = false; detailLoading = false }
  async function findSources() {
    const pending = preview, profile = profiles.find((row) => row.id === profileId), signal = detailAbort?.signal
    if (!pending || !profile || findingSources) return
    findingSources = true; detailError = ''; sourceNotice = ''
    try {
      const requirements = await nuvioApi.profileRequirements(pending.collections, profile, signal)
      if (signal?.aborted) return
      preview = { ...pending, requirements }
      sourceNotice = requirements.length ? 'Select the sources you want to add below.' : 'No matching enabled sources were found in this Nuvio profile.'
    } catch (reason) { if (!signal?.aborted) detailError = reason instanceof Error ? reason.message : 'Could not find profile sources.' }
    finally { if (!signal?.aborted) findingSources = false }
  }
  async function add() {
    if (!preview || saving) return
    saving = true; detailError = ''
    const pending = preview, signal = detailAbort?.signal
    try {
      await installCollectionImport(pending, selectedAddons, signal)
      if (signal?.aborted) return
      notice = `${countLabel(pending.collections.length, 'collection')} added to Home.`
      noticeHref = collectionFolderHref(pending.collections[0].id)
      dialog.close()
    } catch (reason) { if (!signal?.aborted) detailError = reason instanceof Error ? reason.message : 'Could not add this collection.' }
    finally { if (!signal?.aborted) saving = false }
  }
  function applyCover() {
    if (!selected?.imageUrl) return
    const folder = coverFolders.find((folder) => folder.id === coverFolder)
    if (!folder) { detailError = 'Choose a collection and folder first.'; return }
    const artwork = selected
    try {
      homeCollections.update((collections) => collections.map((collection) => collection.id === coverCollection ? { ...collection, folders: collection.folders.map((entry) => entry.id === coverFolder
        ? { ...entry, ...(coverUse === 'focus' ? { focusGifUrl: artwork.imageUrl, focusGifEnabled: true } : { coverImageUrl: artwork.imageUrl, tileShape: artwork.portrait ? 'poster' as const : 'landscape' as const }) } : entry) } : collection))
      notice = `${coverUse === 'focus' ? 'Focus artwork' : 'Cover'} saved for ${folder.title}.`
      noticeHref = collectionFolderHref(coverCollection)
      dialog.close()
    } catch (reason) { detailError = reason instanceof Error ? reason.message : 'Could not save this cover.' }
  }
</script>

<div data-nav-surface="nuvio" class="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-5 sm:px-8 sm:pt-8">
  <div class="flex items-center justify-between gap-3">
    <a href="/app/settings/catalog/collections" data-focusable class="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft class="size-4" />Manage collections</a>
    <a href="/app/home" data-focusable class="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-bold hover:bg-secondary sm:px-4">Open Home <ArrowRight class="size-4" /></a>
  </div>
  <header class="mb-2 mt-3 flex flex-wrap items-end justify-between gap-4 sm:mt-5">
    <div>{#if tab !== 'mine'}<p class="text-xs font-extrabold uppercase tracking-[0.18em] text-muted-foreground">Nuvio community</p>{/if}<h1 class="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{tab === 'mine' ? 'Your Nuvio.' : 'Make Home your own.'}</h1><p class="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{tab === 'mine' ? 'Your profiles, collections and watch history, together in izumi.' : 'Discover collections, find the right cover, and bring your favourites into izumi.'}</p></div>
  </header>
  <NuvioConnection />
  {#if $nuvioSession}
    <nav aria-label="Nuvio library" class="mt-3 flex gap-1 border-b border-border">
      {#each [{ id: 'community', label: 'Community' }, { id: 'covers', label: 'Covers' }, { id: 'mine', label: 'My Nuvio' }] as view}
        <button data-focusable aria-current={tab === view.id ? 'page' : undefined} onclick={() => { tab = view.id; search = ''; query = '' }} class="min-h-12 border-b-2 px-4 text-sm font-extrabold transition-colors {tab === view.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}">{view.label}</button>
      {/each}
    </nav>
    {#if tab === 'mine'}
      {#key $nuvioSession.userId}<NuvioAccount />{/key}
    {:else}
    <div class="my-5 flex flex-col gap-3 lg:flex-row">
      <form onsubmit={(event) => { event.preventDefault(); query = search.trim() }} role="search" class="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
        <Search class="size-4 shrink-0 text-muted-foreground" /><input type="search" data-focusable aria-label={`Search ${tab === 'covers' ? 'covers' : 'collections'}`} placeholder={tab === 'covers' ? 'Search covers…' : 'Search collections…'} bind:value={search} class="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </form>
      <div class="flex flex-wrap items-center gap-2">
        {#if tab === 'mine'}
          <label class="flex items-center gap-2 text-sm text-muted-foreground">Nuvio profile<select data-focusable aria-label="Nuvio profile" bind:value={profileId} class="control">{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select></label>
          <button data-focusable disabled={loading} onclick={() => load()} class="control disabled:opacity-50">Refresh</button>
        {:else}
          {#if tab === 'covers'}
            <select data-focusable aria-label="Cover orientation" bind:value={orientation} class="control"><option value="all">All shapes</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select>
            <select data-focusable aria-label="Cover format" bind:value={format} class="control"><option value="all">All formats</option><option value="gif">GIF</option><option value="jpg">JPG</option><option value="png">PNG</option></select>
          {:else}
            <select data-focusable aria-label="Collection type" bind:value={type} class="control"><option value="all">Collections & packs</option><option value="collection">Collections</option><option value="collection_pack">Packs</option></select>
          {/if}
          <select data-focusable aria-label="Sort results" bind:value={sort} class="control"><option value="popular">Most popular</option><option value="recent">Recently added</option></select>
        {/if}
      </div>
    </div>
    {#if notice}<div role="status" class="mb-5 flex items-center justify-between gap-3 rounded-lg bg-secondary p-4 text-sm"><span class="flex items-center gap-2"><Check class="size-4 shrink-0" />{notice}</span><a href={noticeHref} data-focusable class="shrink-0 font-bold underline underline-offset-4">View collection</a></div>{/if}
    {#if tab === 'mine'}<p class="mb-5 text-sm text-muted-foreground">Choose a collection from your Nuvio profile to add a copy to izumi. Refresh to see your latest changes.</p>{/if}
    {#if error}
      <div role="alert" class="my-6 rounded-lg border border-destructive/40 p-5"><p class="text-sm text-destructive">{error}</p><button data-focusable onclick={() => load()} class="mt-3 min-h-10 rounded-md bg-secondary px-4 text-sm font-bold">Try again</button></div>
    {/if}
    <section aria-label={tab === 'covers' ? 'Cover gallery' : 'Collection gallery'} aria-busy={loading}>
      {#if loading && !items.length && (tab !== 'mine' || !mine.length)}
        <p role="status" class="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />Loading {tab === 'covers' ? 'covers' : 'collections'}…</p>
        <div aria-hidden="true" class="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">{#each Array(8) as _}<div class="aspect-video animate-pulse rounded-xl bg-secondary motion-reduce:animate-none"></div>{/each}</div>
      {:else if tab === 'mine'}
        <div class="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
          {#each visibleMine as collection (collection.id)}
            <button data-focusable onclick={() => inspect({ id: collection.id, title: collection.title, description: '', imageUrl: collection.backdropImageUrl || collection.folders[0]?.coverImageUrl, folderCount: collection.folders.length, collectionCount: 1, installs: 0, kind: 'collection', portrait: false, animated: false }, collection)} class="gallery-card group text-left">
              <span class="block aspect-video overflow-hidden rounded-xl bg-secondary"><NuvioArtwork url={collection.backdropImageUrl || collection.folders[0]?.coverImageUrl} title={collection.title} /></span>
              <span class="mt-3 flex items-center justify-between gap-3"><span class="truncate font-extrabold">{collection.title}</span>{#if $homeCollections.some((row) => row.id === collection.id)}<span class="badge"><Check class="size-3" />Added</span>{/if}</span>
              <span class="mt-1 block text-xs text-muted-foreground">{countLabel(collection.folders.length, 'folder')}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class={tab === 'covers' ? 'columns-2 gap-4 md:columns-3 xl:columns-4' : 'grid grid-cols-2 items-start gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4'}>
          {#each items as item (item.id)}
            <button data-focusable onclick={() => inspect(item)} class="gallery-card group min-w-0 text-left {tab === 'covers' ? 'mb-7 inline-block w-full break-inside-avoid align-top' : ''}">
              <span class="relative block overflow-hidden rounded-xl bg-secondary {item.kind === 'cover' && item.portrait ? 'aspect-[2/3]' : 'aspect-video'}">
                <NuvioArtwork url={item.imageUrl} title={item.title} />
                {#if item.animated}<span class="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-bold text-white">GIF</span>{/if}
              </span>
              <span class="mt-3 flex items-start justify-between gap-2"><span class="line-clamp-2 text-sm font-extrabold leading-5">{item.title}</span>{#if item.kind === 'collection' && installed(item.id)}<span class="badge"><Check class="size-3" />Added</span>{/if}</span>
              <span class="mt-1 block text-xs leading-5 text-muted-foreground">{#if item.kind === 'cover'}{item.portrait ? 'Portrait' : 'Landscape'}{item.animated ? ' · Animated' : ''}{:else}{item.collectionCount > 1 ? `${countLabel(item.collectionCount, 'collection')} · ` : ''}{countLabel(item.folderCount, 'folder')}{/if}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if !loading && !error && (tab === 'mine' ? !visibleMine.length : !items.length)}
        <div class="py-16 text-center"><Folder class="mx-auto mb-4 size-8 text-muted-foreground" /><h2 class="text-lg font-extrabold">{query ? 'No matches yet' : tab === 'mine' ? 'No collections in this profile' : 'Nothing here yet'}</h2><p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{query ? 'Try a different search or change your filters.' : tab === 'mine' ? 'Choose another Nuvio profile, or explore community collections to get started.' : 'Try different filters or check back later.'}</p>{#if tab === 'mine'}<button data-focusable onclick={() => tab = 'community'} class="mt-5 min-h-11 rounded-lg bg-secondary px-5 text-sm font-bold">Explore community</button>{/if}</div>
      {/if}
    </section>
    {#if hasNext && tab !== 'mine'}<div class="mt-9 text-center"><button data-focusable disabled={loading} onclick={() => load(tab, { page: pageNumber + 1, search: query, sort, type, orientation, format })} class="min-h-11 rounded-lg border border-border px-8 text-sm font-bold hover:bg-secondary disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button></div>{/if}
    <p class="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">Community collections and artwork are provided by Nuvio contributors. Additions are saved in izumi; re-add a collection to update its saved copy.</p>
    {/if}
  {/if}
</div>

<dialog bind:this={dialog} onclose={close} aria-labelledby="nuvio-detail-title" class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/70">
  {#if selected}
    <div class="flex max-h-[90dvh] flex-col">
      <header class="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-7"><div><p class="text-xs text-muted-foreground">{selected.kind === 'cover' ? 'Choose artwork' : 'Collection preview'}</p><h2 id="nuvio-detail-title" class="mt-1 text-xl font-black">{selected.title}</h2></div><button data-focusable aria-label="Close preview" onclick={() => dialog.close()} class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-secondary"><X class="size-5" /></button></header>
      <div data-nav-scroll-container class="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7">
        {#if selected.kind === 'cover'}
          <div class="grid items-start gap-6 sm:grid-cols-2">
            <div class="mx-auto max-h-[45dvh] w-full overflow-hidden rounded-xl bg-secondary {selected.portrait ? 'aspect-[2/3] max-w-60' : 'aspect-video'}"><NuvioArtwork url={selected.imageUrl} title={selected.title} contain /></div>
            <div class="space-y-4">
              <h3 class="font-extrabold">Use on a folder</h3>
              {#if $homeCollections.length}
                <label class="block text-sm font-bold">Collection<select data-focusable bind:value={coverCollection} onchange={() => coverFolder = $homeCollections.find((row) => row.id === coverCollection)?.folders[0]?.id || ''} class="control mt-1 w-full">{#each $homeCollections as collection}<option value={collection.id}>{collection.title}</option>{/each}</select></label>
                <label class="block text-sm font-bold">Folder<select data-focusable bind:value={coverFolder} class="control mt-1 w-full">{#each coverFolders as folder}<option value={folder.id}>{folder.title}</option>{/each}</select></label>
                <label class="block text-sm font-bold">Apply as<select data-focusable bind:value={coverUse} class="control mt-1 w-full"><option value="cover">Folder cover</option><option value="focus">Artwork on hover or focus</option></select></label>
                <p class="text-xs leading-relaxed text-muted-foreground">{coverUse === 'cover' ? `Sets the folder to ${selected.portrait ? 'portrait' : 'landscape'} to fit this artwork.` : 'Shows this artwork when the folder is focused. Your usual cover stays in place.'}</p>
              {:else}<p class="text-sm text-muted-foreground">Add a collection first, then choose a cover for one of its folders.</p><button data-focusable onclick={() => { dialog.close(); tab = 'community' }} class="control">Explore collections</button>{/if}
            </div>
          </div>
        {:else if detailLoading}
          <p role="status" class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle class="size-5 animate-spin motion-reduce:animate-none" />Loading folders and sources…</p>
        {:else if preview}
          {#if selected.description}<p class="mb-6 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{selected.description}</p>{/if}
          {#each preview.collections as collection (collection.id)}
            <section class="mb-7"><h3 class="mb-3 flex items-center gap-2 font-extrabold">{collection.title}<span class="text-xs font-normal text-muted-foreground">{countLabel(collection.folders.length, 'folder')}</span></h3>
              <div class="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
                {#each collection.folders as folder (folder.id)}<div class="min-w-0"><div class="aspect-video overflow-hidden rounded-lg bg-secondary"><NuvioArtwork url={folder.coverImageUrl} title={folder.title} contain /></div><p class="mt-2 truncate text-xs font-bold">{folder.title}</p><p class="text-[11px] text-muted-foreground">{countLabel(folder.sources.length, 'catalog')}</p></div>{/each}
              </div>
            </section>
          {/each}
          <section class="space-y-3 border-t border-border pt-5">
            <h3 class="font-extrabold">Sources for these folders</h3>
            {#if !sourceProviders.length}<p class="text-sm text-muted-foreground">These folders have no catalog sources yet.</p>{/if}
            {#if sourceProviders.includes('tmdb')}<p class="text-sm text-muted-foreground">TMDB feeds use your token in <a href="/app/settings/catalog" data-focusable class="font-bold text-foreground underline underline-offset-4">Catalog settings</a>.</p>{/if}
            {#if sourceProviders.includes('trakt')}<p class="text-sm text-muted-foreground">Trakt lists use your connected <a href="/app/settings/accounts" data-focusable class="font-bold text-foreground underline underline-offset-4">Trakt account</a>.</p>{/if}
            {#if missingManifests.length}<p class="text-sm text-muted-foreground">Uses {missingManifests.join(', ')} from your enabled <a href="/app/settings/sources" data-focusable class="font-bold text-foreground underline underline-offset-4">Sources</a>. Add your configured manifests there if needed.</p>{/if}
            {#if tab === 'mine' && missingManifests.length}<button data-focusable disabled={findingSources || saving} onclick={findSources} class="control disabled:opacity-50">{findingSources ? 'Finding profile sources…' : 'Find sources in this Nuvio profile'}</button>{/if}
            {#if sourceNotice}<p role="status" class="text-xs text-muted-foreground">{sourceNotice}</p>{/if}
            {#each preview.requirements as requirement, index}
              {@const enabled = requirement.manifestUrl && $enabledAddonUrls.includes(normalizeBase(requirement.manifestUrl))}
              <label class="flex items-start gap-3 rounded-lg bg-secondary/50 p-3 text-sm"><input data-focusable type="checkbox" bind:group={selectedAddons} value={index} disabled={!requirement.manifestUrl || !!enabled || saving} class="mt-1" /><span><strong>{requirement.addonName}</strong><span class="mt-1 block text-xs leading-relaxed text-muted-foreground">{enabled ? 'Already enabled in izumi.' : requirement.manifestUrl ? 'Also add this included source to izumi. Its catalogs will be checked before saving.' : 'Add your configured manifest in Sources.'}</span></span></label>
            {/each}
            {#if sourceProviders.some((provider) => !['addon', 'tmdb', 'trakt'].includes(provider))}<p class="text-sm text-destructive">Unsupported source types: {sourceProviders.filter((provider) => !['addon', 'tmdb', 'trakt'].includes(provider)).join(', ')}. Those feeds cannot load in izumi.</p>{/if}
            {#if alreadyAdded}<p class="text-xs text-muted-foreground">Re-adding replaces these saved collections, including any cover edits.</p>{/if}
          </section>
        {/if}
        {#if detailError}<p role="alert" class="mt-4 text-sm text-destructive">{detailError}</p>{#if !preview && selected.kind === 'collection'}<button data-focusable onclick={() => inspect(selected!)} class="control mt-3">Try again</button>{/if}{/if}
      </div>
      <footer class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-7"><span class="text-xs text-muted-foreground">{selected.kind === 'cover' ? 'Saved to your izumi folder' : 'Saved to Home in izumi'}</span>
        {#if selected.kind === 'cover'}<button data-focusable disabled={!selected.imageUrl || !coverFolders.some((folder) => folder.id === coverFolder)} onclick={applyCover} class="primary-button">Use {coverUse === 'focus' ? 'focus artwork' : 'cover'}</button>
        {:else}<button data-focusable disabled={!preview || saving || findingSources} onclick={add} class="primary-button">{#if saving}<LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />{/if}{saving ? 'Checking and adding…' : alreadyAdded ? 'Update in izumi' : 'Add to izumi'}</button>{/if}
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .control { min-height: 2.75rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; background: hsl(var(--background)); padding: .5rem .75rem; font-size: .875rem; color: hsl(var(--foreground)); }
  .primary-button { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.75rem; border-radius: .5rem; padding: .6rem 1.25rem; font-size: .875rem; font-weight: 800; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .primary-button:disabled { opacity: .45; }
  .badge { display: inline-flex; flex-shrink: 0; align-items: center; gap: .2rem; border-radius: .3rem; padding: .2rem .35rem; font-size: .65rem; background: hsl(var(--secondary)); }
  .gallery-card { border-radius: .75rem; transition: opacity 160ms; }
  .gallery-card:hover { opacity: .8; }
  button:focus-visible, a:focus-visible, select:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 4px; }
  @media (prefers-reduced-motion: reduce) { .gallery-card { transition: none; } }
</style>
