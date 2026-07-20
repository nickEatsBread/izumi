<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog'
  import { heroMedia } from '$lib/stores/hero'
  import { isAndroid } from '$lib/platform'
  import { fetchMediaById } from '$lib/anilist/fetch-media'
  import { playStream, type PlayState } from '$lib/stremio/play'
  import {
    libraryFolders, libraryEntries, libraryScanning, libraryScanProgress,
    addLibraryFolder, removeLibraryFolder, scanLibrary, searchLibraryAnime,
    matchLibraryEntry, setLibraryEpisode,
  } from '$lib/library/store'
  import type { LibraryEntry, LibraryMedia } from '$lib/library/types'
  import {
    autoDownloadRules, autoDownloadRunning, createAutoDownloadRule,
    updateAutoDownloadRule, removeAutoDownloadRule, runAutoDownloadRules,
  } from '$lib/downloads/rules'
  import FolderPlus from 'lucide-svelte/icons/folder-plus'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'
  import Play from 'lucide-svelte/icons/play'
  import Search from 'lucide-svelte/icons/search'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import WandSparkles from 'lucide-svelte/icons/wand-sparkles'
  import Download from 'lucide-svelte/icons/download'

  heroMedia.set(null)
  let tab = $state<'files' | 'rules'>('files')
  let error = $state('')
  let playState = $state<PlayState>({ status: 'idle' })
  let correcting = $state<LibraryEntry | null>(null)
  let correctionQuery = $state('')
  let correctionResults = $state<LibraryMedia[]>([])
  let correctionBusy = $state(false)
  let ruleQuery = $state('')
  let ruleResults = $state<LibraryMedia[]>([])
  let ruleBusy = $state(false)
  let firstEpisode = $state(1)

  const entries = $derived(Object.values($libraryEntries).sort((a, b) =>
    (a.media?.title.userPreferred || a.guess.title).localeCompare(b.media?.title.userPreferred || b.guess.title)
    || (a.episode ?? 99999) - (b.episode ?? 99999)))
  const matched = $derived(entries.filter((entry) => entry.mediaId))
  const unmatched = $derived(entries.filter((entry) => !entry.mediaId))

  const fmtBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let value = bytes, unit = 0
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
    return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
  }

  async function chooseFolder() {
    error = ''
    try {
      const selected = await open({ directory: true, multiple: true, title: 'Add anime library folders' })
      for (const path of Array.isArray(selected) ? selected : selected ? [selected] : []) addLibraryFolder(path)
      if (selected) await scanLibrary()
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }

  async function rescan() {
    error = ''
    try { await scanLibrary() } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
  }

  async function play(entry: LibraryEntry) {
    if (!entry.mediaId) return
    playState = { status: 'resolving' }
    try {
      const media = await fetchMediaById(entry.mediaId)
      await playStream(media, entry.episode, { url: entry.path, name: 'Local library', behaviorHints: { filename: entry.filename } }, (state) => (playState = state))
    } catch (cause) { playState = { status: 'error', message: cause instanceof Error ? cause.message : String(cause) } }
  }

  async function searchCorrection() {
    correctionBusy = true; correctionResults = []
    try { correctionResults = await searchLibraryAnime(correctionQuery) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { correctionBusy = false }
  }

  async function searchRule() {
    ruleBusy = true; ruleResults = []
    try { ruleResults = await searchLibraryAnime(ruleQuery) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    finally { ruleBusy = false }
  }

  function titleOf(media: LibraryMedia) { return media.title.userPreferred || media.title.english || media.title.romaji || 'Anime' }
</script>

<div class="p-4 pb-24 sm:p-8">
  <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-black">Library</h1>
      <p class="mt-1 text-sm text-muted-foreground">Match video files to anime and automatically collect new episodes.</p>
    </div>
    <div class="flex gap-2">
      {#if !$isAndroid}
        <button data-focusable onclick={chooseFolder} class="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent"><FolderPlus size={17} /> Add folder</button>
      {/if}
      <button data-focusable disabled={$libraryScanning || !$libraryFolders.length} onclick={rescan} class="flex items-center gap-2 rounded-lg bg-theme px-3 py-2 text-sm font-black text-white disabled:opacity-40"><RefreshCw size={17} class={$libraryScanning ? 'animate-spin' : ''} /> Scan</button>
    </div>
  </div>

  <div class="mb-5 flex gap-1 rounded-xl bg-secondary/50 p-1 sm:w-fit">
    <button data-focusable onclick={() => (tab = 'files')} class="flex-1 rounded-lg px-4 py-2 text-sm font-bold {tab === 'files' ? 'bg-background shadow' : 'text-muted-foreground'}">Files ({entries.length})</button>
    <button data-focusable onclick={() => (tab = 'rules')} class="flex-1 rounded-lg px-4 py-2 text-sm font-bold {tab === 'rules' ? 'bg-background shadow' : 'text-muted-foreground'}">Auto-download ({$autoDownloadRules.length})</button>
  </div>

  {#if error}<div class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
  {#if $libraryScanning}<div class="mb-4 rounded-lg bg-theme/10 p-3 text-sm font-bold text-theme">{$libraryScanProgress || 'Scanning…'}</div>{/if}

  {#if tab === 'files'}
    {#if !$isAndroid && $libraryFolders.length}
      <div class="mb-5 flex flex-wrap gap-2">
        {#each $libraryFolders as folder (folder)}
          <span class="flex max-w-full items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs"><span class="truncate">{folder}</span><button aria-label="Remove folder" onclick={() => removeLibraryFolder(folder)}><Trash2 size={13} /></button></span>
        {/each}
      </div>
    {/if}
    {#if !entries.length}
      <div class="rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <FolderPlus class="mx-auto mb-3 text-muted-foreground" size={34} />
        <div class="font-black">No local anime yet</div>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add one or more folders. Izumi scans subfolders, identifies episode filenames, and matches titles through AniList.</p>
        {#if $isAndroid}<p class="mt-3 text-xs text-muted-foreground">Folder scanning is currently available on desktop. Android can receive downloaded episodes through Izumi’s existing download library.</p>{/if}
      </div>
    {:else}
      <div class="max-w-5xl space-y-2">
        {#if unmatched.length}<h2 class="pt-2 text-sm font-black uppercase tracking-wide text-amber-400">Needs a match ({unmatched.length})</h2>{/if}
        {#each [...unmatched, ...matched] as entry (entry.path)}
          <div class="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
            <div class="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
              {#if entry.media?.coverImage?.medium}<img src={entry.media.coverImage.medium} alt="" class="h-full w-full object-cover" />{/if}
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-bold">{entry.media ? titleOf(entry.media) : entry.guess.title}</div>
              <div class="truncate text-xs text-muted-foreground">{entry.filename}</div>
              <div class="mt-1 flex gap-2 text-xs text-muted-foreground"><span>{fmtBytes(entry.size)}</span><span>•</span><span>{entry.episode ? `Episode ${entry.episode}` : 'Episode unknown'}</span>{#if entry.matchConfidence}<span>• {Math.round(entry.matchConfidence * 100)}% match</span>{/if}</div>
            </div>
            {#if entry.mediaId}
              <label class="hidden items-center gap-1 text-xs sm:flex">Ep <input type="number" min="1" value={entry.episode ?? 1} onchange={(event) => setLibraryEpisode(entry.path, Number(event.currentTarget.value))} class="w-16 rounded bg-input px-2 py-1.5" /></label>
              <button data-focusable title="Play local file" onclick={() => play(entry)} class="grid size-10 place-items-center rounded-full bg-theme text-white disabled:opacity-50" disabled={playState.status === 'resolving'}><Play size={17} fill="currentColor" /></button>
            {/if}
            <button data-focusable title="Correct match" onclick={() => { correcting = entry; correctionQuery = entry.guess.title; correctionResults = [] }} class="grid size-10 place-items-center rounded-lg bg-secondary hover:bg-accent"><WandSparkles size={17} /></button>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="max-w-4xl">
      <form onsubmit={(event) => { event.preventDefault(); void searchRule() }} class="mb-5 flex gap-2">
        <label class="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-input px-3"><Search size={16} class="text-muted-foreground" /><input bind:value={ruleQuery} placeholder="Find an anime to follow…" class="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" /></label>
        <input type="number" min="1" bind:value={firstEpisode} title="First episode to download" class="w-20 rounded-lg bg-input px-3 text-sm" />
        <button class="rounded-lg bg-theme px-4 text-sm font-black text-white" disabled={ruleBusy}>{ruleBusy ? 'Finding…' : 'Find'}</button>
      </form>
      {#if ruleResults.length}
        <div class="mb-6 grid gap-2 sm:grid-cols-2">
          {#each ruleResults as media (media.id)}
            <button onclick={() => { createAutoDownloadRule(media, firstEpisode); ruleResults = []; ruleQuery = '' }} class="flex items-center gap-3 rounded-xl bg-secondary/50 p-2 text-left hover:bg-accent">
              {#if media.coverImage?.medium}<img src={media.coverImage.medium} alt="" class="h-14 w-10 rounded object-cover" />{/if}<span class="min-w-0"><span class="block truncate font-bold">{titleOf(media)}</span><span class="text-xs text-muted-foreground">Start at episode {firstEpisode}</span></span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="mb-3 flex items-center justify-between"><h2 class="font-black">Rules</h2><button onclick={() => runAutoDownloadRules()} disabled={$autoDownloadRunning} class="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs font-bold"><RefreshCw size={15} class={$autoDownloadRunning ? 'animate-spin' : ''} /> Check now</button></div>
      {#if !$autoDownloadRules.length}<div class="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Search for a currently airing show, choose the first episode to collect, and Izumi will check every 15 minutes.</div>{/if}
      <div class="space-y-3">
        {#each $autoDownloadRules as rule (rule.id)}
          <div class="rounded-xl border border-border bg-secondary/30 p-4">
            <div class="mb-3 flex items-center gap-3">
              {#if rule.poster}<img src={rule.poster} alt="" class="h-14 w-10 rounded object-cover" />{/if}
              <div class="min-w-0 flex-1"><div class="truncate font-black">{rule.title}</div><div class="text-xs text-muted-foreground">Collect from episode {rule.nextEpisode}{rule.lastRunAt ? ` • checked ${new Date(rule.lastRunAt).toLocaleString()}` : ''}</div>{#if rule.lastError}<div class="mt-1 text-xs text-destructive">{rule.lastError}</div>{/if}</div>
              <button onclick={() => removeAutoDownloadRule(rule.id)} class="grid size-9 place-items-center rounded-lg text-destructive hover:bg-accent"><Trash2 size={16} /></button>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
              <label>Enabled<select value={rule.enabled ? 'yes' : 'no'} onchange={(e) => updateAutoDownloadRule(rule.id, { enabled: e.currentTarget.value === 'yes' })} class="mt-1 w-full rounded bg-input p-2"><option value="yes">On</option><option value="no">Off</option></select></label>
              <label>Quality<select value={rule.quality} onchange={(e) => updateAutoDownloadRule(rule.id, { quality: e.currentTarget.value as typeof rule.quality })} class="mt-1 w-full rounded bg-input p-2"><option value="2160">4K</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="any">Any</option></select></label>
              <label>Audio<select value={rule.audio} onchange={(e) => updateAutoDownloadRule(rule.id, { audio: e.currentTarget.value as typeof rule.audio })} class="mt-1 w-full rounded bg-input p-2"><option value="sub">Sub</option><option value="dub">Dub</option><option value="any">Any</option></select></label>
              <label>Codec<select value={rule.codec} onchange={(e) => updateAutoDownloadRule(rule.id, { codec: e.currentTarget.value as typeof rule.codec })} class="mt-1 w-full rounded bg-input p-2"><option value="any">Any</option><option value="h264">H.264</option><option value="h265">H.265</option><option value="av1">AV1</option></select></label>
              <label>Delay (min)<input type="number" min="0" value={rule.delayMinutes} onchange={(e) => updateAutoDownloadRule(rule.id, { delayMinutes: Number(e.currentTarget.value) })} class="mt-1 w-full rounded bg-input p-2" /></label>
              <label>From episode<input type="number" min="1" value={rule.nextEpisode} onchange={(e) => updateAutoDownloadRule(rule.id, { nextEpisode: Number(e.currentTarget.value) })} class="mt-1 w-full rounded bg-input p-2" /></label>
            </div>
            <label class="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.cachedOnly} onchange={(e) => updateAutoDownloadRule(rule.id, { cachedOnly: e.currentTarget.checked })} /> Only instantly cached sources</label>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if correcting}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation" onclick={(e) => { if (e.currentTarget === e.target) correcting = null }}>
    <div class="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl">
      <h2 class="text-lg font-black">Correct match</h2><p class="mb-3 truncate text-xs text-muted-foreground">{correcting.filename}</p>
      <form onsubmit={(e) => { e.preventDefault(); void searchCorrection() }} class="flex gap-2"><input bind:value={correctionQuery} class="min-w-0 flex-1 rounded-lg bg-input px-3 py-2 text-sm" /><button class="rounded-lg bg-theme px-4 text-sm font-bold text-white">Search</button></form>
      <div class="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {#each correctionResults as media (media.id)}
          <button onclick={() => { if (correcting) matchLibraryEntry(correcting.path, media, correcting.episode); correcting = null }} class="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-secondary">
            {#if media.coverImage?.medium}<img src={media.coverImage.medium} alt="" class="h-12 w-9 rounded object-cover" />{/if}<span class="font-bold">{titleOf(media)}</span>
          </button>
        {/each}
        {#if correctionBusy}<p class="py-6 text-center text-sm text-muted-foreground">Searching…</p>{/if}
      </div>
    </div>
  </div>
{/if}
