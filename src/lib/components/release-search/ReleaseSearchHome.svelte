<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import type { Media } from '$lib/anilist/types'
  import { cover, mediaHref, title } from '$lib/anilist/media'
  import { mediaKey } from '$lib/catalog/identity'
  import { searchMergedCatalogs } from '$lib/catalog/merged-search'
  import { releaseSearchSourceCounts } from '$lib/extensions/manager'
  import { positions, progressKey } from '$lib/player/progress'
  import { episodeForTitle, episodeFromSearch, titleFromSearch } from '$lib/release-search/episode'
  import { forgetRelease, recentReleases, type RecentRelease } from '$lib/release-search/recent'
  import { releaseMedia } from '$lib/release-search/release-media'
  import { searchReleases } from '$lib/release-search/search'
  import { rankQuickSearchResults } from '$lib/search/global-search'
  import { catalogProviders } from '$lib/settings/catalog'
  import { interfaceMode } from '$lib/settings/interface-mode'
  import { offlineMode } from '$lib/stores/offline'
  import { describe, type Stream } from '$lib/stremio/parse'
  import { playEpisode, playStream, type PlayState } from '$lib/stremio/play'
  import { CINEMETA_BASE, enabledAddonUrls, normalizeBase } from '$lib/stremio/sources'
  import ReleaseRow from './ReleaseRow.svelte'

  let text = $state('')
  let searched = $state('')
  let rows = $state<Stream[]>([])
  let titles = $state<Media[]>([])
  let searching = $state(false)
  let sort = $state<'seeders' | 'size'>('seeders')
  let error = $state('')
  let counts = $state<{ searchable: number; unsearchable: number } | null>(null)
  let input = $state<HTMLInputElement>()
  let controller: AbortController | null = null

  // Cinemeta only supplies metadata, so it is not a source of streams.
  const stremioAddons = $derived($enabledAddonUrls.filter((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)).length)
  // Stremio add-ons and online sources only answer for a title, so they are reached through the
  // Titles strip: picking a title opens the normal source picker, which asks every source.
  const titleSources = $derived(stremioAddons + (counts?.unsearchable ?? 0))
  const noSources = $derived(!!counts && counts.searchable === 0 && titleSources === 0)
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
    if (!query) { rows = []; titles = []; searched = ''; return }
    const own = (controller = new AbortController())
    searched = query
    rows = []
    titles = []
    searching = true
    const titleQuery = titleFromSearch(query)
    const findTitles = titleSources && titleQuery
      ? searchMergedCatalogs($catalogProviders, titleQuery, 1, own.signal).then((result) => {
        if (!own.signal.aborted) titles = rankQuickSearchResults(result.media, titleQuery).slice(0, 12)
      }, () => {})
      : Promise.resolve()
    try { await Promise.all([searchReleases(query, (next) => { if (!own.signal.aborted) rows = next }, own.signal), findTitles]) }
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

  /** The searched episode in this title's numbering. AniList titles are one season each; other
   *  catalogs number episodes across seasons, so a later season needs the title's episode list. */
  function episodeFor(media: Media): number | undefined {
    const asked = episodeForTitle(searched, [media.title.romaji, media.title.english, media.title.userPreferred].filter((name): name is string => !!name))
    if (!asked) return undefined
    if (!asked.season || asked.season === 1 || !media.catalog || media.catalog.provider === 'anilist') return asked.episode
    return media.videos?.find((video) => video.season === asked.season && video.episode === asked.episode)?.number
  }

  function pickTitle(media: Media) {
    error = ''
    const movie = media.format === 'MOVIE' || media.type === 'MOVIE' || media.catalog?.type === 'movie'
    const episode = movie ? undefined : episodeFor(media)
    // A series without an exact episode from the search opens its page, where every episode is listed.
    if (!movie && episode == null) return void goto(mediaHref(media))
    void playEpisode(media, episode, report, { forceManual: true })
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

<div class="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-8 sm:pt-12">
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

    {#if noSources}
      <div class="mt-8 rounded-2xl border border-border bg-secondary/30 p-6">
        <h2 class="text-lg font-semibold">Add a source</h2>
        <p class="mt-1 text-sm text-muted-foreground">This screen searches only the sources you add. izumi doesn't come with any.</p>
        <a href="/app/settings/sources" data-focusable class="mt-4 inline-block rounded-lg bg-theme px-4 py-2 text-sm font-semibold text-white">Open Sources</a>
      </div>
    {:else if searched}
      {#if titles.length}
        <h2 class="mt-6 text-sm font-semibold text-muted-foreground">Titles</h2>
        <p class="text-xs text-muted-foreground">Pick one to see every source for it.</p>
        <ul class="mt-2 flex gap-3 overflow-x-auto pb-2">
          {#each titles as media (mediaKey(media))}
            <li class="w-24 shrink-0">
              <button type="button" data-focusable data-title-pick onclick={() => pickTitle(media)} class="w-full text-left">
                <img src={cover(media)} alt="" loading="lazy" class="aspect-[2/3] w-full rounded-lg bg-secondary object-cover" />
                <span class="mt-1 line-clamp-2 text-xs">{title(media)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? 'release' : 'releases'}{searching ? ' · searching…' : ''}
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
      {:else if !searching && !titles.length}
        <p class="mt-8 text-center text-sm text-muted-foreground">Nothing matched. Try fewer words.</p>
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
