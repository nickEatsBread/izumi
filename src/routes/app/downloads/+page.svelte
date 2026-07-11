<script lang="ts">
  import { downloads, speeds, pauseDownload, resumeDownload, cancelDownload, deleteDownload, revealDownload, type DownloadItem } from '$lib/downloads/store'
  import { getDownloadedMedia } from '$lib/downloads/state'
  import { playEpisode } from '$lib/stremio/play'
  import { fetchMediaById } from '$lib/anilist/fetch-media'
  import { heroMedia } from '$lib/stores/hero'
  import Search from 'lucide-svelte/icons/search'
  import Play from 'lucide-svelte/icons/play'
  import Pause from 'lucide-svelte/icons/pause'
  import RotateCw from 'lucide-svelte/icons/rotate-cw'
  import X from 'lucide-svelte/icons/x'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import FolderOpen from 'lucide-svelte/icons/folder-open'

  heroMedia.set(null)

  let filter = $state('')
  const match = (d: DownloadItem) => !filter.trim() || d.title.toLowerCase().includes(filter.trim().toLowerCase())
  const list = $derived(Object.values($downloads).filter(match).sort((a, b) => b.addedAt - a.addedAt))
  const active = $derived(list.filter((d) => d.status === 'downloading' || d.status === 'paused'))
  const queued = $derived(list.filter((d) => d.status === 'queued'))
  const errored = $derived(list.filter((d) => d.status === 'error'))
  const done = $derived(list.filter((d) => d.status === 'done'))
  const totalBytes = $derived(done.reduce((s, d) => s + (d.bytes || 0), 0))

  const fmtBytes = (n?: number) => {
    if (!n) return '0 MB'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
  }
  const pctOf = (d: DownloadItem) => (d.bytes ? Math.round((d.downloaded / d.bytes) * 100) : 0)
  const etaOf = (d: DownloadItem) => {
    const sp = $speeds[d.id]
    if (!sp || !d.bytes) return ''
    const s = Math.max(0, (d.bytes - d.downloaded) / sp)
    const m = Math.floor(s / 60)
    return m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m` : `${Math.round(s)}s`
  }

  async function playLocal(d: DownloadItem) {
    try {
      // Offline-first: use the cached series snapshot (no network); fall back online.
      const m = getDownloadedMedia(d.mediaId) ?? await fetchMediaById(d.mediaId)
      playEpisode(m, d.episode, () => {})
    } catch { /* ignore */ }
  }
</script>

{#snippet row(d: DownloadItem)}
  <div class="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3">
    {#if d.poster}<img src={d.poster} alt="" class="h-14 w-10 shrink-0 rounded object-cover" />{:else}<div class="h-14 w-10 shrink-0 rounded bg-muted"></div>{/if}
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-bold">{d.title}</span>
        {#if d.quality}<span class="shrink-0 rounded bg-lime-500/15 px-1.5 text-[0.6rem] font-black text-lime-300">{d.quality}</span>{/if}
      </div>
      {#if d.status === 'downloading' || d.status === 'paused'}
        <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div class="h-full bg-blue-400 transition-[width] duration-300 ease-out" style="width:{pctOf(d)}%"></div>
        </div>
        <div class="mt-1 flex flex-wrap gap-x-3 text-[0.7rem] text-muted-foreground">
          <span>{pctOf(d)}% · {fmtBytes(d.downloaded)}{d.bytes ? ` / ${fmtBytes(d.bytes)}` : ''}</span>
          {#if d.status === 'downloading' && $speeds[d.id]}<span>{fmtBytes($speeds[d.id])}/s</span><span>{etaOf(d)} left</span>{/if}
          {#if d.status === 'paused'}<span class="text-amber-400">Paused</span>{/if}
        </div>
      {:else if d.status === 'queued'}
        <div class="mt-0.5 text-[0.7rem] text-muted-foreground">Queued…</div>
      {:else if d.status === 'error'}
        <div class="mt-0.5 truncate text-[0.7rem] text-destructive" title={d.error}>{d.error ?? 'Failed'}</div>
      {:else}
        <div class="mt-0.5 text-[0.7rem] text-muted-foreground">{fmtBytes(d.bytes)} · downloaded</div>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-1">
      {#if d.status === 'done'}
        <button data-focusable title="Play" onclick={() => playLocal(d)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><Play size={16} /></button>
        <button data-focusable title="Reveal in folder" onclick={() => revealDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><FolderOpen size={16} /></button>
        <button data-focusable title="Delete file" onclick={() => deleteDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 text-destructive hover:bg-accent"><Trash2 size={16} /></button>
      {:else if d.status === 'downloading'}
        <button data-focusable title="Pause" onclick={() => pauseDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><Pause size={16} /></button>
        <button data-focusable title="Cancel" onclick={() => cancelDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><X size={16} /></button>
      {:else if d.status === 'paused' || d.status === 'error'}
        <button data-focusable title={d.status === 'error' ? 'Retry' : 'Resume'} onclick={() => resumeDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><RotateCw size={16} /></button>
        <button data-focusable title="Cancel" onclick={() => cancelDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><X size={16} /></button>
      {:else}
        <button data-focusable title="Cancel" onclick={() => cancelDownload(d.id)} class="grid size-10 place-items-center rounded-md sm:size-8 hover:bg-accent"><X size={16} /></button>
      {/if}
    </div>
  </div>
{/snippet}

<div class="p-4 sm:p-8">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-black">Downloads</h1>
    <div class="flex flex-wrap items-center justify-end gap-3">
      <span class="text-sm text-muted-foreground">{fmtBytes(totalBytes)} used · {done.length} saved</span>
      <label class="flex w-full items-center gap-2 rounded-lg bg-secondary px-3 py-1.5 sm:w-auto">
        <Search size={15} class="text-muted-foreground" />
        <input bind:value={filter} data-focusable placeholder="Filter…" class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-40" />
      </label>
    </div>
  </div>

  {#if !list.length}
    <p class="mt-16 text-center text-muted-foreground">No downloads yet. Use the download button on an episode.</p>
  {:else}
    <div class="max-w-3xl space-y-6">
      {#if active.length}
        <section><h2 class="mb-2 text-sm font-black uppercase tracking-wide text-muted-foreground">Downloading</h2><div class="space-y-2">{#each active as d (d.id)}{@render row(d)}{/each}</div></section>
      {/if}
      {#if queued.length}
        <section><h2 class="mb-2 text-sm font-black uppercase tracking-wide text-muted-foreground">Queued</h2><div class="space-y-2">{#each queued as d (d.id)}{@render row(d)}{/each}</div></section>
      {/if}
      {#if errored.length}
        <section><h2 class="mb-2 text-sm font-black uppercase tracking-wide text-destructive">Failed</h2><div class="space-y-2">{#each errored as d (d.id)}{@render row(d)}{/each}</div></section>
      {/if}
      {#if done.length}
        <section><h2 class="mb-2 text-sm font-black uppercase tracking-wide text-muted-foreground">Completed</h2><div class="space-y-2">{#each done as d (d.id)}{@render row(d)}{/each}</div></section>
      {/if}
    </div>
  {/if}
</div>
