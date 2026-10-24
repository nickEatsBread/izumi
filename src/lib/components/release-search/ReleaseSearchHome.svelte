<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { releaseSearchSourceCounts } from '$lib/extensions/manager'
  import { positions, progressKey } from '$lib/player/progress'
  import { episodeFromSearch } from '$lib/release-search/episode'
  import { forgetRelease, recentReleases, type RecentRelease } from '$lib/release-search/recent'
  import { releaseMedia } from '$lib/release-search/release-media'
  import { searchReleases } from '$lib/release-search/search'
  import { interfaceMode } from '$lib/settings/interface-mode'
  import { offlineMode } from '$lib/stores/offline'
  import { describe, type Stream } from '$lib/stremio/parse'
  import { playStream, type PlayState } from '$lib/stremio/play'
  import { CINEMETA_BASE, enabledAddonUrls, normalizeBase } from '$lib/stremio/sources'
  import ReleaseRow from './ReleaseRow.svelte'

  let text = $state('')
  let searched = $state('')
  let rows = $state<Stream[]>([])
  let searching = $state(false)
  let sort = $state<'seeders' | 'size'>('seeders')
  let error = $state('')
  let counts = $state<{ searchable: number; unsearchable: number } | null>(null)
  let input = $state<HTMLInputElement>()
  let controller: AbortController | null = null

  // Cinemeta only supplies metadata, so it is not a source this screen skipped.
  const stremioAddons = $derived($enabledAddonUrls.filter((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)).length)
  const skipped = $derived((counts?.unsearchable ?? 0) + stremioAddons)
  const want = $derived(episodeFromSearch(searched))
  const sortOptions = [{ id: 'seeders', label: 'Seeders' }, { id: 'size', label: 'Size' }] as const
  const sorted = $derived([...rows].sort((a, b) => sort === 'size'
    ? (describe(b).sizeBytes ?? -1) - (describe(a).sizeBytes ?? -1)
    : (describe(b).seeders ?? -1) - (describe(a).seeders ?? -1)))

  onMount(() => {
    input?.focus()
    releaseSearchSourceCounts().then((value) => (counts = value), () => (counts = { searchable: 0, unsearchable: 0 }))
  })
  onDestroy(() => controller?.abort())

  async function search() {
    const query = text.trim()
    controller?.abort()
    error = ''
    if (!query) { rows = []; searched = ''; return }
    const own = (controller = new AbortController())
    searched = query
    rows = []
    searching = true
    try { await searchReleases(query, (next) => { if (!own.signal.aborted) rows = next }, own.signal) }
    finally { if (controller === own) searching = false }
  }

  const report = (state: PlayState) => { if (state.status === 'error') error = state.message ?? 'Playback failed.' }

  function play(stream: Stream) {
    const media = releaseMedia(stream, want)
    // Singles always use episode 1 so their resume point doesn't depend on what was typed.
    const episode = media.release?.pack ? want?.episode ?? 1 : 1
    error = ''
    void playStream(media, episode, stream, report)
  }

  function resume(entry: RecentRelease) {
    error = ''
    void playStream(releaseMedia(entry.stream, { episode: entry.episode, season: entry.season }), entry.episode, entry.stream, report)
  }

  function clock(seconds: number): string {
    const s = Math.floor(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const rest = String(s % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
  }
</script>

<div data-slot="release-search" class="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-8 sm:pt-12">
  {#if $offlineMode}
    <OfflineUnavailable title="Search is unavailable offline" subtitle="Searching your sources needs a connection. Your downloads are available on the Downloads page." />
  {:else}
    <form role="search" onsubmit={(event) => { event.preventDefault(); void search() }}>
      <label class="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-input px-4">
        <Search size={20} class="shrink-0 text-muted-foreground" />
        <input bind:this={input} bind:value={text} type="search" data-focusable enterkeyhint="search" autocomplete="off" spellcheck="false"
          aria-label="Search your sources" placeholder="Title, episode, quality…" class="min-w-0 flex-1 bg-transparent text-base outline-none" />
      </label>
    </form>

    {#if error}<p role="alert" class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}

    {#if counts && counts.searchable === 0}
      <div class="mt-8 rounded-2xl border border-border bg-secondary/30 p-6">
        <h2 class="text-lg font-semibold">Add a tracker feed or torrent extension</h2>
        <p class="mt-1 text-sm text-muted-foreground">This screen searches only the sources you add. izumi doesn't come with any.</p>
        <a href="/app/settings/sources" data-focusable class="mt-4 inline-block rounded-lg bg-theme px-4 py-2 text-sm font-semibold text-white">Open Sources</a>
      </div>
    {:else if searched}
      <p class="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? 'release' : 'releases'}{#if searching}&nbsp;· searching…{/if}
        {#if skipped}&nbsp;· <a href="/app/settings/sources" class="underline underline-offset-2">{skipped} {skipped === 1 ? "source can't" : "sources can't"} search by text</a>{/if}
      </p>
      {#if rows.length}
        <div class="mt-3 flex items-center gap-1 text-xs text-muted-foreground" role="radiogroup" aria-label="Sort">
          <span class="mr-1">Sort</span>
          {#each sortOptions as option (option.id)}
            <button type="button" role="radio" aria-checked={sort === option.id} data-focusable onclick={() => (sort = option.id)}
              class="rounded-md px-2 py-1 {sort === option.id ? 'bg-secondary font-semibold text-foreground' : 'hover:bg-secondary/60'}">{option.label}</button>
          {/each}
        </div>
        <ul class="mt-2 divide-y divide-border border-t border-border">
          {#each sorted as stream (stream.infoHash)}
            <li><ReleaseRow {stream} episode={want?.episode} onpick={() => play(stream)} /></li>
          {/each}
        </ul>
      {:else if !searching}
        <p class="mt-8 text-center text-sm text-muted-foreground">No releases matched. Try fewer words.</p>
      {/if}
    {:else if $recentReleases.length}
      <h2 class="mt-8 text-sm font-semibold text-muted-foreground">Recent</h2>
      <ul class="mt-2 divide-y divide-border border-t border-border">
        {#each $recentReleases as entry (entry.mediaId)}
          {@const at = $positions[progressKey(entry.mediaId, entry.episode)]?.pos ?? 0}
          <li class="flex items-center gap-2">
            <button type="button" data-focusable onclick={() => resume(entry)} class="min-w-0 flex-1 py-3 text-left">
              <span class="block truncate text-sm">{entry.title}</span>
              <span class="block text-xs text-muted-foreground">{at > 0 ? `Resume at ${clock(at)}` : 'Play again'}</span>
            </button>
            <button type="button" data-focusable aria-label={`Remove ${entry.title} from Recent`} onclick={() => forgetRelease(entry.mediaId)}
              class="grid size-9 shrink-0 place-items-center rounded-full hover:bg-secondary"><X size={16} /></button>
          </li>
        {/each}
      </ul>
    {/if}

    <button type="button" data-focusable onclick={() => ($interfaceMode = 'catalogs')} class="mt-10 text-xs text-muted-foreground underline underline-offset-2">Switch to catalogs</button>
  {/if}
</div>
