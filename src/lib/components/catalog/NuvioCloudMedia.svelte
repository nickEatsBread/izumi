<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import { nuvioCloud, cloudIdentity, type Resource, type ResourceState, type CloudItem } from '$lib/nuvio/cloud'
  import { importCloudItems, localCloudItems, nuvioOrigin, knownMedia } from '$lib/nuvio/transfer'
  import { cloudMatchesMedia, cloudToMedia } from '$lib/nuvio/media'
  import { catalogMediaHref } from '$lib/catalog/identity'
  import { enabledAddonUrls } from '$lib/stremio/sources'
  import NuvioArtwork from './NuvioArtwork.svelte'
  let { profileId, kind }: { profileId: number; kind: Resource } = $props()
  let data = $state.raw<ResourceState>(), metadata = $state.raw<CloudItem[]>([]), local = $state.raw<Media[]>([])
  let loading = $state(true), busy = $state(false), error = $state(''), notice = $state(''), search = $state(''), limit = $state(60)
  let selection = $state<string[]>([]), upload = $state.raw<CloudItem[]>([]), skipped = $state(0), action = $state<'upload' | 'delete' | 'import'>('upload')
  let dialog: HTMLDialogElement
  const abort = new AbortController()
  const label = $derived(kind === 'library' ? 'Library' : kind === 'progress' ? 'Continue watching' : 'Watch history')
  const title = (row: CloudItem) => row.name || row.title || metadata.find((item) => item.content_id === row.content_id && item.content_type === row.content_type)?.name || local.find((media) => cloudMatchesMedia(row, media))?.title.userPreferred || row.content_id
  const subtitle = (row: CloudItem) => `${row.content_type === 'movie' ? 'Movie' : `Series${row.season != null && row.episode != null ? ` · S${row.season} E${row.episode}` : ''}`}${kind === 'progress' ? ` · ${Math.floor((row.position ?? 0) / 60000)} / ${Math.floor((row.duration ?? 0) / 60000)} min` : ''}`
  const filtered = $derived((data?.items ?? []).filter((row) => title(row).toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.last_watched || b.watched_at || b.added_at || 0) - Number(a.last_watched || a.watched_at || a.added_at || 0)))
  const selected = $derived((data?.items ?? []).filter((row) => selection.includes(cloudIdentity(kind, row))))
  const href = (row: CloudItem) => { const media = local.find((media) => cloudMatchesMedia(row, media)) ?? cloudToMedia({ ...metadata.find((item) => item.content_id === row.content_id && item.content_type === row.content_type), ...row }, $enabledAddonUrls); return media ? catalogMediaHref(media) : undefined }
  onMount(() => { void load() }); onDestroy(() => abort.abort())
  async function run(work: () => Promise<void>) { busy = true; error = ''; notice = ''; try { await work() } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not transfer cloud data.' } finally { if (!abort.signal.aborted) busy = false } }
  async function load(full = false) {
    loading = true
    await run(async () => {
      const result = await nuvioCloud.refresh(kind, profileId, full ? undefined : data, abort.signal)
      const known = await knownMedia()
      if (abort.signal.aborted) return
      data = result; local = known; selection = []
      if (kind !== 'library' && !metadata.length) {
        try { const rows = await nuvioCloud.snapshot('library', profileId, abort.signal); if (!abort.signal.aborted) metadata = rows } catch { /* Playback remains usable without optional poster metadata. */ }
      }
    })
    if (!abort.signal.aborted) loading = false
  }
  async function reviewUpload() {
    await run(async () => {
      const pending = await localCloudItems(kind)
      if (abort.signal.aborted) return
      upload = pending.items; skipped = pending.skipped; action = 'upload'; dialog.showModal()
    })
  }
  async function confirm() {
    await run(async () => {
      if (action === 'delete') {
        await nuvioCloud.remove(kind, profileId, selected, nuvioOrigin(), abort.signal)
        if (abort.signal.aborted) return
        dialog.close(); await load(true); notice = 'Selected entries removed from Nuvio.'
      } else if (action === 'import') {
        const rows = selected.map((row) => ({ ...metadata.find((item) => item.content_id === row.content_id && item.content_type === row.content_type), ...row }))
        // Build watched-through counts from earliest episodes first, without inventing watched gaps.
        if (kind === 'history') rows.sort((a, b) => Number(a.watched_at) - Number(b.watched_at) || Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode))
        const result = await importCloudItems(kind, rows, abort.signal)
        if (abort.signal.aborted) return
        dialog.close(); notice = `${result.imported} entries copied to izumi.${result.skipped ? ` ${result.skipped} skipped because they have newer local data, unavailable metadata, or episode numbering that cannot be matched.` : ''}`
      } else {
        // Fresh remote clocks protect progress recorded elsewhere while the review was open.
        const latest = await nuvioCloud.refresh(kind, profileId, undefined, abort.signal)
        const index = new Map(latest.items.map((row) => [cloudIdentity(kind, row), row]))
        const values = upload.filter((row) => {
          const old = index.get(cloudIdentity(kind, row))
          return !old || kind !== 'library' && Number(row.last_watched || row.watched_at || 0) > Number(old.last_watched || old.watched_at || 0)
        })
        await nuvioCloud.upsert(kind, profileId, values, nuvioOrigin(), abort.signal)
        if (abort.signal.aborted) return
        dialog.close(); await load(true); notice = `${values.length} entries saved to Nuvio. Existing library entries and newer playback data were kept.`
      }
    })
  }
</script>

<div class="nv-toolbar"><div><h3 class="text-lg font-extrabold">{label}</h3><p class="nv-help mt-1">{kind === 'library' ? 'Your saved Nuvio movies and series.' : kind === 'progress' ? 'Your latest 200 resume points, followed by new cloud changes.' : 'Movies and episodes marked watched in Nuvio.'}</p></div><div class="flex flex-wrap gap-2"><button data-focusable class="nv-btn" disabled={busy} onclick={() => load()}>Refresh</button><button data-focusable class="nv-btn" disabled={busy} onclick={reviewUpload}>Copy from izumi…</button></div></div>
{#if error}<p class="nv-error" role="alert">{error}<button data-focusable class="ml-3 underline" disabled={busy} onclick={() => load(true)}>Full refresh</button></p>{/if}{#if notice}<p class="nv-notice" role="status">{notice}</p>{/if}
<input class="nv-input mb-4" type="search" data-focusable aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} bind:value={search} oninput={() => limit = 60} />
{#if loading}<p class="nv-empty" role="status">Loading {label.toLowerCase()}…</p>{:else}
  <div class="mb-3 flex flex-wrap items-center gap-3"><label class="flex items-center gap-2 text-sm"><input data-focusable type="checkbox" checked={filtered.length > 0 && filtered.every((row) => selection.includes(cloudIdentity(kind, row)))} onchange={(event) => selection = event.currentTarget.checked ? filtered.map((row) => cloudIdentity(kind, row)) : []} />Select {filtered.length} entries</label>{#if selection.length}<span class="nv-help sm:ml-auto">{selected.length} selected</span><button data-focusable class="nv-btn" disabled={busy} onclick={() => { action = 'import'; dialog.showModal() }}>Copy to izumi…</button><button data-focusable class="nv-btn nv-danger" disabled={busy} onclick={() => { action = 'delete'; dialog.showModal() }}>Remove from Nuvio…</button>{/if}</div>
  {#each filtered.slice(0, limit) as row (cloudIdentity(kind, row))}
    <div class="nv-row"><input data-focusable type="checkbox" aria-label={`Select ${title(row)} ${subtitle(row)}`} value={cloudIdentity(kind, row)} bind:group={selection} /><div class="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-secondary"><NuvioArtwork url={row.poster || metadata.find((item) => item.content_id === row.content_id && item.content_type === row.content_type)?.poster || undefined} title={title(row)} /></div><div class="min-w-0 flex-1">{#if href(row)}<a data-focusable class="block truncate text-sm font-extrabold hover:underline" href={href(row)}>{title(row)}</a>{:else}<p class="truncate text-sm font-extrabold">{title(row)}</p>{/if}<p class="nv-help mt-1 text-xs">{subtitle(row)}</p>{#if kind === 'progress'}<progress class="mt-2 h-1.5 w-full max-w-sm accent-primary" aria-label="Playback progress" value={Math.max(0, row.position ?? 0)} max={Math.max(1, row.duration ?? 0)}></progress>{/if}{#if row.watched_at || row.last_watched}<p class="nv-help mt-1 text-xs">{new Date(Number(row.watched_at || row.last_watched)).toLocaleDateString()}</p>{/if}</div></div>
  {/each}
  {#if !filtered.length}<p class="nv-empty">{search ? 'No matching titles.' : 'Nothing saved in this Nuvio profile yet.'}</p>{/if}
  {#if filtered.length > limit}<button data-focusable class="nv-btn mt-5" onclick={() => limit += 60}>Show more ({filtered.length - limit} remaining)</button>{/if}
{/if}
<dialog bind:this={dialog} class="nv-dialog" aria-labelledby="nv-transfer-title" oncancel={(event) => { if (busy) event.preventDefault() }}>
  <div class="nv-toolbar"><h3 class="text-xl font-black" id="nv-transfer-title">{action === 'delete' ? 'Remove cloud entries' : action === 'upload' ? 'Copy to Nuvio' : 'Copy to izumi'}</h3><button data-focusable class="nv-btn" disabled={busy} onclick={() => dialog.close()}>Cancel</button></div>
  <p class="nv-help">{action === 'delete' ? `Remove ${selected.length} selected entries from this Nuvio profile? This updates your other Nuvio devices too. Local izumi data stays saved.` : action === 'upload' ? `${upload.length} matching ${kind === 'library' ? 'Watchlist' : 'playback'} entries are ready. This adds missing entries and keeps newer cloud playback data.` : `Copy ${selected.length} entries to ${kind === 'library' ? 'your izumi Watchlist' : 'izumi’s saved playback data'}. Newer local data is kept. Metadata sources must already be available in izumi.`}</p>
  {#if action === 'upload' && skipped}<p class="nv-help mt-3">{skipped} local entries have no compatible Nuvio identity or episode coordinates and will be skipped.</p>{/if}
  <ul data-nav-scroll-container class="my-5 max-h-64 space-y-2 overflow-y-auto text-sm">{#each (action === 'upload' ? upload : selected).slice(0, 100) as row}<li class="flex justify-between gap-3"><span class="truncate">{title(row)}</span><span class="shrink-0 text-xs text-muted-foreground">{subtitle(row)}</span></li>{/each}</ul>
  {#if error}<p class="nv-error" role="alert">{error}</p>{/if}
  <button data-focusable class="nv-btn {action === 'delete' ? 'nv-danger' : 'nv-primary'}" disabled={busy || !(action === 'upload' ? upload.length : selected.length)} onclick={confirm}>{busy ? 'Transferring…' : action === 'delete' ? 'Remove selected cloud entries' : action === 'upload' ? 'Copy entries to Nuvio' : 'Copy entries to izumi'}</button>
</dialog>
