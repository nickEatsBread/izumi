<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioCloud, sameCloudValue, type CloudBlob, type CloudProfile, type JsonRecord } from '$lib/nuvio/cloud'
  import { nuvioSession, string, object } from '$lib/nuvio/auth'
  import { prepareNuvioImport, nuvioApi } from '$lib/nuvio/api'
  import { homeCollections } from '$lib/catalog/collections/store'
  import { parseCollectionImport } from '$lib/catalog/collections/model'
  import { installCollectionImport } from '$lib/catalog/collections/install'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { normalizeBase } from '$lib/stremio/sources'
  import NuvioArtwork from './NuvioArtwork.svelte'
  import NuvioCoverPicker from './NuvioCoverPicker.svelte'
  type Folder = JsonRecord & { id: string; title: string; coverImageUrl?: string; focusGifUrl?: string; focusGifEnabled?: boolean; tileShape?: string; hideTitle?: boolean; coverEmoji?: string; heroBackdropUrl?: string; titleLogoUrl?: string; sources?: JsonRecord[]; catalogSources?: JsonRecord[] }
  type Collection = JsonRecord & { id: string; title: string; folders: Folder[]; backdropImageUrl?: string; pinToTop?: boolean; viewMode?: string; showAllTab?: boolean }
  let { profile }: { profile: CloudProfile } = $props()
  let baseline = $state.raw<CloudBlob>({ value: [] }), rows = $state<Collection[]>([]), draft = $state<Collection | null>(null), editingId = $state('')
  let loading = $state(true), busy = $state(false), error = $state(''), notice = $state(''), search = $state('')
  let showLocal = $state(false), localSelection = $state<string[]>([]), selectedFolder = $state(''), artwork = $state<'cover' | 'focus' | ''>('')
  let catalogs = $state.raw<Array<{ label: string; source: JsonRecord }>>([]), catalogIndex = $state(-1), catalogsBusy = $state(false)
  let advanced = $state(false), json = $state(''), includeSources = $state(false)
  let dialog = $state<HTMLDialogElement>(null!), jsonDialog = $state<HTMLDialogElement>(null!)
  const abort = new AbortController()
  const changed = $derived(!sameCloudValue(rows, baseline.value))
  const filtered = $derived(rows.filter((row) => row.title.toLowerCase().includes(search.toLowerCase())))
  const folder = $derived(draft?.folders.find((entry) => entry.id === selectedFolder))
  const sources = (folder: Folder) => folder.sources?.length ? folder.sources : folder.catalogSources ?? []
  onMount(() => { void load() }); onDestroy(() => abort.abort())
  async function run(work: () => Promise<void>) { busy = true; error = ''; notice = ''; try { await work() } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not update collections.' } finally { if (!abort.signal.aborted) busy = false } }
  async function load() { loading = true; await run(async () => { const value = await nuvioCloud.blob('collections', profile.profile_index, 'izumi', abort.signal); if (!abort.signal.aborted) { baseline = value; rows = structuredClone(value.value) as Collection[] } }); if (!abort.signal.aborted) loading = false }
  function edit(row?: Collection) {
    editingId = row?.id ?? ''; draft = row ? structuredClone($state.snapshot(row)) : { id: crypto.randomUUID(), title: '', folders: [], viewMode: 'TABBED_GRID', showAllTab: true }
    selectedFolder = draft.folders[0]?.id ?? ''; artwork = ''; advanced = false; includeSources = false; error = ''; dialog.showModal()
  }
  function addFolder() { if (!draft) return; const id = crypto.randomUUID(); draft.folders = [...draft.folders, { id, title: 'New folder', tileShape: 'LANDSCAPE', catalogSources: [] }]; selectedFolder = id; artwork = '' }
  function stage() {
    if (!draft) return
    try {
      if (advanced) { const value = JSON.parse(json); parseCollectionImport(JSON.stringify(value)); draft = value as Collection }
      parseCollectionImport(JSON.stringify(draft))
      if (rows.some((row) => row.id === draft!.id && row.id !== editingId)) throw new Error('Another collection already uses this ID.')
      rows = editingId ? rows.map((row) => row.id === editingId ? $state.snapshot(draft!) : row) : [...rows, $state.snapshot(draft)]
      dialog.close(); notice = 'Collection added to the draft. Save your collections to update Nuvio.'
    } catch (reason) { error = reason instanceof Error ? reason.message : 'Check this collection.' }
  }
  function stageLocal() {
    const selected = $homeCollections.filter((row) => localSelection.includes(row.id)).map(({ nuvioOrigin, ...row }) => ({ ...row, id: `izumi:${row.id}`, folders: row.folders.map(({ sources, ...folder }) => ({ ...folder, tileShape: folder.tileShape.toUpperCase(), catalogSources: sources.map((source) => ({ ...source })) })) }))
    const merged = new Map(rows.map((row) => [row.id, row])); for (const row of selected) merged.set(row.id, row)
    rows = [...merged.values()]; showLocal = false; notice = `${selected.length} collections added to the draft. Review and save to Nuvio.`
  }
  async function importLocal(row: Collection) {
    await run(async () => {
      const parsed = await prepareNuvioImport([row], `profile:${$nuvioSession?.userId}:${profile.profile_index}`)
      if (includeSources) parsed.requirements = await nuvioApi.profileRequirements(parsed.collections, { id: profile.profile_index, name: profile.name, usesPrimaryAddons: profile.uses_primary_addons === true }, abort.signal)
      await installCollectionImport(parsed, includeSources ? parsed.requirements.map((_, index) => index) : [], abort.signal)
      if (!abort.signal.aborted) { dialog.close(); notice = `${row.title} added to izumi Home.` }
    })
  }
  async function findCatalogs() {
    catalogsBusy = true; error = ''
    try {
      const addons = (await nuvioCloud.addons(profile.uses_primary_addons ? 1 : profile.profile_index, abort.signal)).filter((row) => row.enabled !== false)
      if (addons.length > 100) throw new Error('This profile has more than 100 enabled sources. Use the JSON editor for catalog references.')
      const choices: typeof catalogs = []
      for (let offset = 0; offset < addons.length; offset += 4) {
        if (abort.signal.aborted) return
        const batch = await Promise.all(addons.slice(offset, offset + 4).map((row) => fetchManifest(normalizeBase(row.url))))
        for (const manifest of batch) if (manifest) for (const catalog of manifest.catalogs ?? []) choices.push({ label: `${manifest.name} · ${catalog.name || catalog.id} (${catalog.type})`, source: { addonId: manifest.id, type: catalog.type, catalogId: catalog.id } })
      }
      if (!abort.signal.aborted) { catalogs = choices; catalogIndex = choices.length ? 0 : -1; if (!choices.length) error = 'No catalogs found in this profile’s enabled sources.' }
    } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not inspect catalogs.' }
    finally { if (!abort.signal.aborted) catalogsBusy = false }
  }
  function move(index: number, direction: number) { const next = [...rows]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; rows = next }
  function applyDocument() { try { const value = JSON.parse(json); if (!Array.isArray(value)) throw new Error('Use an array of collections.'); if (value.length) parseCollectionImport(json); rows = value; jsonDialog.close(); notice = 'Document added to the draft. Review before saving to Nuvio.' } catch (reason) { error = reason instanceof Error ? reason.message : 'Invalid JSON.' } }
</script>

<div class="nv-toolbar"><div><h3 class="text-lg font-extrabold">Collections</h3><p class="nv-help mt-1">Arrange folders and artwork in {profile.name}’s Nuvio Home.</p></div><div class="flex flex-wrap gap-2"><button data-focusable class="nv-btn" disabled={busy} onclick={load}>Reload collections</button><button data-focusable class="nv-btn nv-primary" disabled={busy} onclick={() => edit()}>New collection</button></div></div>
{#if error && !dialog?.open && !jsonDialog?.open}<p class="nv-error" role="alert">{error}</p>{/if}{#if notice}<p class="nv-notice" role="status">{notice}</p>{/if}
{#if loading}<p class="nv-empty" role="status">Loading collections…</p>{:else}
  <div class="mb-5 flex flex-col gap-3 sm:flex-row"><input class="nv-input flex-1" type="search" placeholder="Search your collections…" aria-label="Search cloud collections" bind:value={search} /><button data-focusable class="nv-btn shrink-0" disabled={busy} onclick={() => showLocal = !showLocal}>Add from izumi</button></div>
  {#if showLocal}<div class="nv-panel mb-6"><h4 class="font-bold">Choose izumi collections</h4><p class="nv-help mt-1">Re-adding updates their Nuvio copies. Add community collections to izumi first to bring them here.</p><div data-nav-scroll-container="nested" class="my-4 max-h-60 overflow-y-auto space-y-3">{#each $homeCollections as row}<label class="flex items-center gap-3 text-sm"><input data-focusable type="checkbox" bind:group={localSelection} value={row.id} />{row.title}</label>{/each}</div>{#if !$homeCollections.length}<p class="nv-help mb-3">No local collections yet. Explore the Community tab.</p>{/if}<button data-focusable class="nv-btn" disabled={!localSelection.length} onclick={stageLocal}>Add selected to draft</button></div>{/if}
  <div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{#each filtered as row (row.id)}<article class="min-w-0"><button data-focusable class="group w-full text-left" disabled={busy} onclick={() => edit(row)}><span class="block aspect-video overflow-hidden rounded-xl bg-secondary"><NuvioArtwork url={row.backdropImageUrl || row.folders?.[0]?.coverImageUrl} title={row.title} /></span><span class="mt-3 block truncate font-extrabold">{row.title}</span><span class="nv-help mt-1 block text-xs">{row.folders?.length ?? 0} folders · Edit collection</span></button><div class="mt-3 flex gap-2"><button data-focusable class="nv-btn px-3" aria-label={`Move ${row.title} up`} disabled={busy || rows.indexOf(row) === 0} onclick={() => move(rows.indexOf(row), -1)}>↑</button><button data-focusable class="nv-btn px-3" aria-label={`Move ${row.title} down`} disabled={busy || rows.indexOf(row) === rows.length - 1} onclick={() => move(rows.indexOf(row), 1)}>↓</button><button data-focusable class="nv-btn ml-auto" disabled={busy} onclick={() => rows = rows.filter((item) => item.id !== row.id)}>Remove from draft</button></div></article>{/each}</div>
  {#if !filtered.length}<p class="nv-empty">{search ? 'No matching collections.' : 'Create a collection or bring one over from izumi.'}</p>{/if}
  <div class="mt-7 flex flex-wrap items-center gap-3 border-t border-border pt-5"><button data-focusable class="nv-btn nv-primary" disabled={busy || !changed} onclick={() => run(async () => { await nuvioCloud.saveBlob('collections', profile.profile_index, $state.snapshot(rows), baseline, 'izumi', abort.signal); if (!abort.signal.aborted) { await load(); notice = 'Collections saved to Nuvio.' } })}>{busy ? 'Saving…' : rows.length ? 'Save collections to Nuvio' : 'Save empty collection list to Nuvio'}</button><button data-focusable class="nv-btn" disabled={busy} onclick={() => { json = JSON.stringify(rows, null, 2); error = ''; jsonDialog.showModal() }}>Import / edit JSON</button>{#if changed}<span class="nv-help">Unsaved changes · {rows.length} collections</span>{/if}</div>
{/if}
<dialog class="nv-dialog max-w-4xl" bind:this={dialog} aria-labelledby="nv-collection-edit" oncancel={(event) => { if (busy) event.preventDefault() }}>
  <div class="nv-toolbar"><h3 class="text-xl font-black" id="nv-collection-edit">{editingId ? 'Edit collection' : 'New collection'}</h3><button data-focusable class="nv-btn" disabled={busy} onclick={() => dialog.close()}>Close</button></div>
  {#if draft}<fieldset disabled={busy} class="space-y-5">
    <label class="nv-label">Collection title<input class="nv-input" bind:value={draft.title} maxlength="500" /></label>
    <div class="grid gap-4 sm:grid-cols-2"><label class="nv-label">Layout<select data-focusable class="nv-input" bind:value={draft.viewMode}><option value="TABBED_GRID">Tabbed grid</option><option value="ROWS">Rows</option><option value="FOLLOW_LAYOUT">Follow Home layout</option></select></label><label class="nv-label">Backdrop URL<input class="nv-input" type="url" bind:value={draft.backdropImageUrl} placeholder="https://…" /></label></div>
    <div class="flex flex-wrap gap-5 text-sm"><label class="flex items-center gap-2"><input data-focusable type="checkbox" bind:checked={draft.pinToTop} />Pin to top</label><label class="flex items-center gap-2"><input data-focusable type="checkbox" checked={draft.showAllTab !== false} onchange={(event) => { if (draft) draft.showAllTab = event.currentTarget.checked }} />Show All tab</label></div>
    <div class="flex flex-wrap gap-3"><label class="nv-label min-w-0 flex-1">Folder<select data-focusable class="nv-input" bind:value={selectedFolder} onchange={() => artwork = ''}><option value="" disabled>Choose a folder</option>{#each draft.folders as entry}<option value={entry.id}>{entry.title}</option>{/each}</select></label><button data-focusable class="nv-btn mt-6" onclick={addFolder}>New folder</button></div>
    {#if folder}<div class="nv-panel space-y-4">
      <div class="grid gap-4 sm:grid-cols-[120px_1fr]"><div class="aspect-[4/3] overflow-hidden rounded-lg bg-secondary"><NuvioArtwork url={folder.coverImageUrl} title={folder.title} /></div><div class="space-y-3"><label class="nv-label">Folder title<input class="nv-input" bind:value={folder.title} /></label><div class="flex gap-2"><button data-focusable class="nv-btn" onclick={() => artwork = artwork === 'cover' ? '' : 'cover'}>Browse covers</button><button data-focusable class="nv-btn" onclick={() => artwork = artwork === 'focus' ? '' : 'focus'}>Focus artwork</button></div></div></div>
      {#if artwork}<NuvioCoverPicker close={() => artwork = ''} choose={(url, portrait) => { if (!folder) return; if (artwork === 'focus') { folder.focusGifUrl = url; folder.focusGifEnabled = true } else { folder.coverImageUrl = url; folder.tileShape = portrait ? 'POSTER' : 'LANDSCAPE' } artwork = '' }} />{/if}
      <div class="grid gap-4 sm:grid-cols-2"><label class="nv-label">Cover URL<input class="nv-input" bind:value={folder.coverImageUrl} /></label><label class="nv-label">Focus artwork URL<input class="nv-input" bind:value={folder.focusGifUrl} /></label><label class="nv-label">Tile shape<select data-focusable class="nv-input" bind:value={folder.tileShape}><option value="POSTER">Poster</option><option value="LANDSCAPE">Landscape</option><option value="SQUARE">Square</option></select></label><label class="nv-label">Emoji<input class="nv-input" bind:value={folder.coverEmoji} /></label></div>
      <div class="flex flex-wrap gap-4 text-sm"><label class="flex items-center gap-2"><input data-focusable type="checkbox" bind:checked={folder.hideTitle} />Hide title</label><label class="flex items-center gap-2"><input data-focusable type="checkbox" checked={folder.focusGifEnabled !== false} onchange={(event) => { if (folder) folder.focusGifEnabled = event.currentTarget.checked }} />Enable focus artwork</label></div>
      <h4 class="font-bold">Folder catalogs</h4>{#each sources(folder) as source, index}<div class="flex items-center justify-between gap-3 text-sm"><span class="min-w-0 truncate">{string(source.title) || string(source.catalogId) || string(source.tmdbSourceType) || 'Catalog'}<span class="nv-help ml-2 text-xs">{string(source.addonId) || string(source.provider)}</span></span><button data-focusable class="nv-btn" onclick={() => { if (!folder) return; const next = sources(folder).filter((_, at) => at !== index); if (folder.sources?.length) folder.sources = next; else folder.catalogSources = next }}>Remove</button></div>{/each}
      <button data-focusable class="nv-btn" disabled={catalogsBusy} onclick={findCatalogs}>{catalogsBusy ? 'Finding catalogs…' : 'Find catalogs from profile sources'}</button>
      {#if catalogs.length}<div class="flex flex-col gap-2 sm:flex-row"><select data-focusable class="nv-input" aria-label="Catalog to add" bind:value={catalogIndex}>{#each catalogs as catalog, index}<option value={index}>{catalog.label}</option>{/each}</select><button data-focusable class="nv-btn shrink-0" onclick={() => { if (!folder || !catalogs[catalogIndex]) return; const next = [...sources(folder), catalogs[catalogIndex].source]; if (folder.sources?.length) folder.sources = next; else folder.catalogSources = next }}>Add catalog</button></div>{/if}
      <div class="flex flex-wrap gap-2 border-t border-border pt-4"><button data-focusable class="nv-btn" disabled={draft.folders.indexOf(folder) === 0} onclick={() => { if (!draft || !folder) return; const next = [...draft.folders], index = next.indexOf(folder); [next[index - 1], next[index]] = [next[index], next[index - 1]]; draft.folders = next }}>Move folder earlier</button><button data-focusable class="nv-btn nv-danger" onclick={() => { if (!draft || !folder) return; draft.folders = draft.folders.filter((row) => row.id !== folder.id); selectedFolder = draft.folders[0]?.id ?? ''; artwork = '' }}>Remove folder</button></div>
    </div>{/if}
    <button data-focusable class="nv-btn" onclick={() => { json = JSON.stringify(draft, null, 2); advanced = !advanced }}>Advanced collection JSON</button>
    {#if advanced}<label class="nv-label">Collection document<textarea class="nv-input min-h-72 font-mono text-xs" spellcheck="false" bind:value={json}></textarea><span class="nv-help text-xs">Includes TMDB, Trakt, filters, and any additional Nuvio fields. Applying uses this complete document.</span></label>{/if}
    <div class="flex flex-wrap gap-3 border-t border-border pt-5"><button data-focusable class="nv-btn nv-primary" onclick={stage}>Apply to collection draft</button>{#if editingId}<button data-focusable class="nv-btn" onclick={() => { if (draft) void importLocal($state.snapshot(draft)) }}>Copy collection to izumi</button>{/if}</div>
    {#if editingId}<label class="flex items-start gap-3 text-sm"><input data-focusable type="checkbox" bind:checked={includeSources} /><span>Also add matching enabled sources from this Nuvio profile. Source manifests are checked before installation.</span></label>{/if}
  </fieldset>{/if}
  {#if error}<p class="nv-error" role="alert">{error}</p>{/if}
</dialog>
<dialog class="nv-dialog" bind:this={jsonDialog} aria-labelledby="nv-collections-json"><div class="nv-toolbar"><h3 class="text-xl font-black" id="nv-collections-json">Collection document</h3><button data-focusable class="nv-btn" onclick={() => jsonDialog.close()}>Cancel</button></div><p class="nv-help mb-4">Paste Nuvio’s exported collection array. This replaces the draft; saving then replaces the cloud collection list. An empty array clears it.</p><label class="nv-label">Collections JSON<textarea class="nv-input min-h-80 font-mono text-xs" spellcheck="false" bind:value={json}></textarea></label>{#if error}<p class="nv-error" role="alert">{error}</p>{/if}<button data-focusable class="nv-btn nv-primary mt-4" onclick={applyDocument}>Review as draft</button></dialog>
