<script lang="ts">
  import { onDestroy } from 'svelte'
  import { homeCollections } from '$lib/catalog/collections/store'
  import { COLLECTION_IMPORT_MAX_BYTES, collectionFolderHref, collectionImageUrl, type CollectionFolder, type CollectionImport } from '$lib/catalog/collections/model'
  import { readCollectionImport } from '$lib/catalog/collections/import'
  import { installCollectionImport } from '$lib/catalog/collections/install'
  import CollectionFolderCard from '$lib/components/catalog/CollectionFolderCard.svelte'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'

  let input = $state('')
  let preview = $state.raw<CollectionImport | null>(null)
  let selectedAddons = $state<number[]>([])
  let busy = $state(false)
  let error = $state('')
  let notice = $state('')
  let expanded = $state('')
  let editing = $state<{ collectionId: string; folder: CollectionFolder } | null>(null)
  let coverUrl = $state('')
  let focusUrl = $state('')
  let abort: AbortController | undefined
  const folders = $derived(preview?.collections.flatMap((collection) => collection.folders) ?? [])
  const providers = $derived([...new Set(folders.flatMap((folder) => folder.sources.map((source) => source.provider)))])
  const replacements = $derived(preview?.collections.filter((collection) => $homeCollections.some((existing) => existing.id === collection.id)).length ?? 0)
  // Controller-only stops: the preview list is text a d-pad can walk (and so scroll through); it
  // stays out of the mouse and touch focus order.
  const stops = $derived($gameMode || $controllerMode)
  const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
  onDestroy(() => abort?.abort())

  async function inspect(value = input) {
    abort?.abort()
    abort = new AbortController()
    const controller = abort
    busy = true
    error = ''
    notice = ''
    preview = null
    selectedAddons = []
    try { preview = await readCollectionImport(value, controller.signal) }
    catch (reason) { if (!controller.signal.aborted) error = reason instanceof Error ? reason.message : String(reason) }
    finally { if (!controller.signal.aborted) busy = false }
  }

  async function readFile(event: Event) {
    const control = event.currentTarget as HTMLInputElement
    const file = control.files?.[0]
    if (!file) return
    if (file.size > COLLECTION_IMPORT_MAX_BYTES) { error = 'Collection files must be smaller than 8 MB.'; preview = null; control.value = ''; return }
    try { input = await file.text(); await inspect(input) }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    finally { control.value = '' }
  }

  async function install() {
    if (!preview || busy) return
    const pending = preview
    abort?.abort()
    abort = new AbortController()
    const controller = abort
    busy = true
    error = ''
    try {
      await installCollectionImport(pending, selectedAddons, controller.signal)
      if (controller.signal.aborted) return
      notice = `Imported ${countLabel(pending.collections.length, 'collection')} with ${countLabel(folders.length, 'folder')}. Open Home to browse them.`
      preview = null
      input = ''
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    } finally { busy = false }
  }

  function editCover(collectionId: string, folder: CollectionFolder) {
    editing = { collectionId, folder: { ...folder } }
    coverUrl = folder.coverImageUrl ?? ''
    focusUrl = folder.focusGifUrl ?? ''
    error = ''
  }

  function saveCover() {
    if (!editing) return
    const cover = collectionImageUrl(coverUrl)
    const focus = collectionImageUrl(focusUrl)
    if ((coverUrl.trim() && !cover) || (focusUrl.trim() && !focus)) { error = 'Use a direct HTTP(S) image URL, such as Nuvio’s Copy Raw URL.'; return }
    if ([cover, focus].some((url) => url && new URL(url).hostname === 'nuvio.tv' && new URL(url).pathname === '/covers')) {
      error = 'Open the cover on Nuvio and choose Copy Raw URL. The covers library page is not an image.'
      return
    }
    const saved = { ...editing.folder, coverImageUrl: cover, focusGifUrl: focus }
    const collectionId = editing.collectionId
    try {
      homeCollections.update((collections) => collections.map((collection) => collection.id === collectionId
        ? { ...collection, folders: collection.folders.map((folder) => folder.id === saved.id ? saved : folder) } : collection))
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
      return
    }
    editing = null
    error = ''
    notice = 'Cover saved.'
  }

  function move(id: string, direction: number) {
    homeCollections.update((collections) => {
      const next = [...collections]
      const at = next.findIndex((collection) => collection.id === id)
      const to = at + direction
      if (at >= 0 && to >= 0 && to < next.length) [next[at], next[to]] = [next[to], next[at]]
      return next
    })
  }
</script>

<div class="max-w-4xl space-y-6 p-4 sm:p-8">
  <div>
    <a href="/app/settings/catalog" data-focusable class="text-sm text-muted-foreground">← Catalog</a>
    <h1 class="mt-3 text-2xl font-black">Collections & covers</h1>
    <p class="mt-2 text-sm text-muted-foreground">Bring Nuvio folders and their artwork to Home. Collections appear on every catalog screen.</p>
  </div>

  <section class="flex flex-col justify-between gap-5 rounded-xl border border-border bg-secondary/30 p-5 sm:flex-row sm:items-center">
    <div><h2 class="text-lg font-black">Explore Nuvio</h2><p class="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">Connect your account to browse community collections, covers, and your Nuvio profiles directly in izumi.</p></div>
    <a href="/app/nuvio" data-focusable class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground">Browse Nuvio →</a>
  </section>

  <section aria-labelledby="collection-import-title" class="space-y-4 rounded-xl border border-border p-4 sm:p-5">
    <h2 id="collection-import-title" class="text-lg font-black">Import from a file or URL</h2>
    <label class="block text-sm font-semibold">Collection JSON or direct JSON file URL
      <textarea bind:value={input} data-focusable oninput={() => preview = null} disabled={busy} rows="5" placeholder="Paste exported collection JSON or a JSON file URL" class="mt-2 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs disabled:opacity-50"></textarea>
    </label>
    <div class="flex flex-wrap items-center gap-3">
      <button data-focusable disabled={busy || !input.trim()} onclick={() => inspect()} class="min-h-10 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy ? 'Working…' : 'Preview import'}</button>
      <label class="text-sm font-semibold">Or choose a JSON file
        <input type="file" data-focusable accept=".json,application/json" disabled={busy} onchange={readFile} class="mt-1 block max-w-full text-xs" />
      </label>
    </div>

    {#if preview}
      <div class="space-y-3 border-t border-border pt-4">
        <p class="font-bold">{countLabel(preview.collections.length, 'collection')} · {countLabel(folders.length, 'folder')} · {countLabel(folders.reduce((count, folder) => count + folder.sources.length, 0), 'catalog')}</p>
        <ul data-nav-scroll-container="nested" class="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-muted-foreground">
          {#each preview.collections as collection (collection.id)}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><li data-focusable={stops ? '' : undefined} tabindex={stops ? 0 : undefined}>{collection.title} — {collection.folders.length} folders</li>{/each}
        </ul>
        {#if replacements}<p class="text-sm">{replacements} existing collections with matching IDs will be updated, including their covers. Other collections stay in place.</p>{/if}
        {#if providers.includes('tmdb')}<p class="text-sm text-muted-foreground">TMDB feeds need a Read Access Token in <a href="/app/settings/catalog" data-focusable class="text-primary underline">Catalog settings</a>.</p>{/if}
        {#if providers.includes('trakt')}<p class="text-sm text-muted-foreground">Trakt lists need a connected account in <a href="/app/settings/accounts" data-focusable class="text-primary underline">Accounts</a>.</p>{/if}
        {#if providers.some((provider) => !['addon', 'tmdb', 'trakt'].includes(provider))}<p class="text-sm text-destructive">Some folders use unsupported providers: {providers.filter((provider) => !['addon', 'tmdb', 'trakt'].includes(provider)).join(', ')}. Their catalogs will show an explanation when opened.</p>{/if}
        {#if providers.includes('addon')}<p class="text-sm text-muted-foreground">Add-on catalogs use your enabled Sources. A collection export may omit the add-on installation URLs; add your configured manifests separately if needed.</p>{/if}
        {#each preview.requirements as requirement, index}
          <label class="flex items-start gap-3 rounded-md bg-secondary/50 p-3 text-sm">
            <input type="checkbox" data-focusable disabled={!requirement.manifestUrl || busy} bind:group={selectedAddons} value={index} class="mt-1" />
            <span><strong>{requirement.addonName}</strong><span class="mt-1 block text-muted-foreground">{requirement.manifestUrl ? 'Also install or enable the included add-on after checking its catalogs.' : 'No included manifest. Add your configured URL in Sources.'}</span></span>
          </label>
        {/each}
        <button data-focusable disabled={busy} onclick={install} class="min-h-10 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Import {countLabel(preview.collections.length, 'collection')}</button>
      </div>
    {/if}
  </section>

  {#if error}<p role="alert" class="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</p>{/if}
  {#if notice}<p role="status" class="rounded-lg bg-secondary p-4 text-sm">{notice} <a href="/app/home" data-focusable class="font-bold text-primary">Open Home</a></p>{/if}

  {#if editing}
    <form onsubmit={(event) => { event.preventDefault(); saveCover() }} class="space-y-4 rounded-xl border border-primary/40 p-4 sm:p-5">
      <h2 class="text-lg font-black">Edit cover · {editing.folder.title}</h2>
      <a href={`/app/nuvio?${new URLSearchParams({ tab: 'covers', collection: editing.collectionId, folder: editing.folder.id })}`} data-focusable class="inline-flex min-h-10 items-center rounded-lg bg-secondary px-4 text-sm font-bold">Choose from Nuvio covers →</a>
      <div class="flex flex-col gap-5 sm:flex-row">
        <CollectionFolderCard collectionId={editing.collectionId} folder={{ ...editing.folder, coverImageUrl: collectionImageUrl(coverUrl), focusGifUrl: collectionImageUrl(focusUrl) }} />
        <div class="flex-1 space-y-3">
          <label class="block text-sm font-semibold">Cover image URL<input bind:value={coverUrl} type="url" data-focusable placeholder="Paste Copy Raw URL from Nuvio" class="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3" /></label>
          <label class="block text-sm font-semibold">Focus GIF URL (optional)<input bind:value={focusUrl} type="url" data-focusable class="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3" /></label>
          <label class="block text-sm font-semibold">Shape<select data-focusable bind:value={editing.folder.tileShape} class="ml-3 min-h-10 rounded-md bg-secondary px-3"><option value="poster">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option></select></label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-focusable bind:checked={editing.folder.hideTitle} />Hide title over artwork</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-focusable bind:checked={editing.folder.focusGifEnabled} />Animate on focus</label>
        </div>
      </div>
      <div class="flex gap-3"><button data-focusable class="min-h-10 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Save cover</button><button type="button" data-focusable onclick={() => editing = null} class="min-h-10 rounded-md bg-secondary px-4 text-sm font-bold">Cancel</button></div>
    </form>
  {/if}

  <section aria-labelledby="your-collections-title" class="space-y-3">
    <h2 id="your-collections-title" class="text-lg font-black">Your collections</h2>
    {#if !$homeCollections.length}<p class="text-sm text-muted-foreground">Import a collection to add folders and covers to Home.</p>{/if}
    {#each $homeCollections as collection, index (collection.id)}
      <div class="rounded-xl border border-border p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <button data-focusable aria-expanded={expanded === collection.id} onclick={() => expanded = expanded === collection.id ? '' : collection.id} class="text-left font-bold">{collection.title}<span class="ml-2 text-sm font-normal text-muted-foreground">{collection.folders.length} folders</span></button>
          <div class="flex items-center gap-1">
            <button data-focusable disabled={index === 0} aria-label={`Move ${collection.title} up`} onclick={() => move(collection.id, -1)} class="min-h-10 min-w-10 rounded-md hover:bg-secondary disabled:opacity-30">↑</button>
            <button data-focusable disabled={index === $homeCollections.length - 1} aria-label={`Move ${collection.title} down`} onclick={() => move(collection.id, 1)} class="min-h-10 min-w-10 rounded-md hover:bg-secondary disabled:opacity-30">↓</button>
            <button data-focusable onclick={() => homeCollections.update((collections) => collections.filter((item) => item.id !== collection.id))} class="min-h-10 rounded-md px-3 text-sm text-destructive hover:bg-secondary">Remove</button>
          </div>
        </div>
        {#if expanded === collection.id}
          <div class="mt-4 divide-y divide-border">
            {#each collection.folders as folder (folder.id)}
              <div class="flex items-center justify-between gap-3 py-3">
                <a href={collectionFolderHref(collection.id, folder.id)} data-focusable class="min-w-0 text-sm font-semibold hover:text-primary">{folder.title}<span class="ml-2 font-normal text-muted-foreground">{folder.sources.length} catalogs</span></a>
                <button data-focusable onclick={() => editCover(collection.id, folder)} class="min-h-10 shrink-0 rounded-md bg-secondary px-3 text-sm font-bold">Edit cover</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </section>
</div>
