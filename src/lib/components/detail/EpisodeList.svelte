<script lang="ts">
  // Episode grid. Only *aired* episodes are playable (aired = nextAiringEpisode-1,
  // not the planned total). Upcoming episodes render greyed with an air countdown
  // for the next one. Long-runners (One Piece) are paginated. The layout (rich
  // `cards` vs simple `compact` rows) follows the persisted Appearance setting;
  // per-episode thumbnails/titles/ratings come from AniZip.
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import { airedCount, totalEpisodes } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { getEpisodeMeta } from '$lib/anizip'
  import type { EpMeta } from '$lib/anizip/types'
  import {
    episodeLayout, hideSpoilers, downloadQuality, downloadAudio, downloadCodec, downloadCachedOnly,
  } from '$lib/settings/ui'
  import { localHistory, sessionProgress, manualProgressOverrides, setLocalProgress } from '$lib/player/history'
  import { updateProgress } from '$lib/trackers'
  import { episodeLabels } from '$lib/anilist/episode-labels'
  import { fillerEpisodes } from '$lib/anime/filler'
  import { orderEpisodes, type SortDir } from '$lib/anime/episode-order'
  import * as h from '$lib/haptics'
  import { enqueueMany, downloads, keyFor } from '$lib/downloads/store'
  import {
    autoDownloadRules, removeAutoDownloadForMedia, subscribeAutoDownloads,
  } from '$lib/downloads/rules'
  import EpisodeCard from './EpisodeCard.svelte'
  import Download from 'lucide-svelte/icons/download'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Pause from 'lucide-svelte/icons/pause'
  import Check from 'lucide-svelte/icons/check'
  import Search from 'lucide-svelte/icons/search'
  import Shuffle from 'lucide-svelte/icons/shuffle'
  import ListChecks from 'lucide-svelte/icons/list-checks'
  let { media, offline = false }: { media: Media; offline?: boolean } = $props()

  // Offline: the playable set is exactly the DOWNLOADED episodes (the download keys carry the
  // episode number), sourced from the store — independent of totalEpisodes()/the schedule, which
  // would collapse to 0 for OVA/ONA/adult snapshots and hide the very episodes you have on disk.
  const offlineEps = $derived(
    offline
      ? Object.values($downloads)
          .filter((d) => d.mediaId === media.id && d.status === 'done')
          .map((d) => d.episode)
          .sort((a, b) => a - b)
      : [],
  )

  const next = $derived(media.nextAiringEpisode)
  // Planned total + how many have already aired. Both fall back to the per-episode airing
  // schedule when AniList's scalar `episodes`/`nextAiringEpisode` are null (common on OVAs/
  // ONAs and adult titles), so a title known only through its schedule still lists its
  // episodes instead of collapsing to "Episodes TBA".
  const total = $derived(offline ? offlineEps.length : totalEpisodes(media))
  // aired = last episode that has already aired, never more than the total. airedCount can
  // be Infinity when the count is genuinely unknown — clamp that to the total (0 → "TBA").
  // Offline: every downloaded episode is playable, so aired = the highest downloaded number.
  const aired = $derived.by(() => {
    if (offline) return offlineEps.at(-1) ?? 0
    const a = airedCount(media)
    return Math.min(total, Number.isFinite(a) ? a : total)
  })
  const watchedThrough = $derived(
    $manualProgressOverrides[media.id] ?? Math.max(
      media.mediaListEntry?.progress ?? 0,
      $localHistory[media.id]?.progress ?? 0,
      $sessionProgress[media.id] ?? 0,
    ),
  )

  const PER = 48
  // `page` stays null until the user manually pages; until then we show `autoPage` — the page that
  // holds the next episode to watch — so opening a long-running series (One Piece) lands on where
  // you're up to, not episode 1. Deriving it (vs a one-shot init) keeps it right if progress
  // hydrates a tick late, and it stops following once the user hits Prev/Next.
  let page = $state<number | null>(null)
  const pages = $derived(Math.max(1, Math.ceil(total / PER)))
  const autoPage = $derived(
    Math.min(pages - 1, Math.max(0, Math.floor((Math.min(watchedThrough + 1, total) - 1) / PER))),
  )
  const curPage = $derived(page ?? autoPage)
  const startIdx = $derived(curPage * PER)
  const allEpisodes = $derived(
    offline ? offlineEps : Array.from({ length: total }, (_, index) => index + 1),
  )
  let episodeQuery = $state('')
  const searchedEpisodes = $derived.by(() => {
    const query = episodeQuery.trim().toLocaleLowerCase().replace(/^ep(?:isode)?\s*/i, '')
    if (!query) return null
    return allEpisodes.filter((episode) =>
      String(episode).includes(query)
      || meta[episode]?.title?.toLocaleLowerCase().includes(query)
      || String(meta[episode]?.abs ?? '').includes(query))
  })
  const eps = $derived(
    searchedEpisodes ?? (
    offline
      ? offlineEps.slice(startIdx, startIdx + PER)
      : allEpisodes.slice(startIdx, startIdx + PER)
    ),
  )

  // Oldest/Newest toggle: reorders the current page's episodes for display. Pagination itself
  // still pages ascending (startIdx/PER above are unchanged) — see the note near the toggle.
  let sortDir = $state<SortDir>('asc')
  let numberMode = $state<'series' | 'absolute'>('series')
  const rows = $derived(orderEpisodes(eps, sortDir))
  function toggleSort(dir: SortDir) { if (dir !== sortDir) { h.select(); sortDir = dir } }

  // Per-episode metadata from AniZip (thumbnail/title/rating). Best-effort; the
  // cards fall back to the show art when a given episode has no entry.
  let meta = $state<Record<number, EpMeta>>({})
  let metaLoading = $state(true)
  $effect(() => {
    if (offline) { meta = {}; metaLoading = false; return } // no per-episode metadata fetch offline
    let cancelled = false
    metaLoading = true
    getEpisodeMeta(media.id, watchedThrough).then((m) => { if (!cancelled) { meta = m; metaLoading = false } })
    return () => { cancelled = true }
  })

  // Only show per-episode thumbnails when AniZip actually has *distinct* per-ep
  // art. If every episode maps to the same image (or none do), that's series art
  // masquerading as thumbnails — hide it and render text-forward cards instead.
  const showThumbs = $derived.by(() => {
    const imgs = Object.values(meta).map((e) => e.image).filter(Boolean)
    return new Set(imgs).size > 1
  })

  // Filler episodes (AnimeFillerList) — marked in the list.
  let fillerSet = $state<Set<number>>(new Set())
  $effect(() => {
    if (offline) return // no filler-list fetch offline
    let cancelled = false
    fillerEpisodes(media.id).then((list) => { if (!cancelled) fillerSet = new Set(list) })
    return () => { cancelled = true }
  })

  let playState = $state<PlayState>({ status: 'idle' })
  const resolving = $derived(playState.status === 'resolving')
  function play(ep: number) { if (!resolving) playEpisode(media, ep, (s) => (playState = s)) }
  const absoluteAvailable = $derived(Object.entries(meta).some(([episode, value]) =>
    value.abs != null && value.abs !== Number(episode)))
  const numberLabel = (episode: number) =>
    numberMode === 'absolute' && meta[episode]?.abs != null ? `A${meta[episode].abs}` : String(episode)

  let progressTarget = $state(0)
  let progressStatus = $state('')
  $effect(() => { if (!progressTarget && watchedThrough) progressTarget = watchedThrough })
  async function applyProgress() {
    const value = Math.max(0, Math.min(aired, Math.floor(Number(progressTarget) || 0)))
    progressTarget = value
    setLocalProgress(media, value)
    const status = total > 0 && value >= total ? 'COMPLETED' : 'CURRENT'
    const trackers = await updateProgress(media, value, status)
    progressStatus = `Watched through episode ${value}${trackers.length ? ` · synced to ${trackers.join(' + ')}` : ' · saved locally'}`
  }
  async function clearProgress() {
    progressTarget = 0
    await applyProgress()
  }
  function randomEpisode() {
    if (aired < 1 || resolving) return
    play(1 + Math.floor(Math.random() * aired))
  }

  // Downloads are a deliberate MULTI-SELECT mode instead of a per-episode button under
  // every card (which doubled the D-pad stops and cluttered the grid). A "Download" button
  // enters select mode: tapping episodes toggles them, then one action queues the batch.
  let selecting = $state(false)
  let selected = $state<Set<number>>(new Set())
  let followNew = $state(false)
  const airedList = $derived(Array.from({ length: aired }, (_, i) => i + 1))
  const subscription = $derived($autoDownloadRules.find((rule) => rule.mediaId === media.id))
  // A tap on a released episode plays it — or, in select mode, toggles its selection.
  // Upcoming (unaired) episodes are neither playable nor selectable.
  function tap(ep: number) {
    if (ep > aired) return
    if (!selecting) { play(ep); return }
    const n = new Set(selected)
    n.has(ep) ? n.delete(ep) : n.add(ep)
    selected = n
  }
  function startSelect() { selecting = true; selected = new Set(); followNew = !!subscription }
  function cancelSelect() { selecting = false; selected = new Set(); followNew = false }
  const allAiredSelected = $derived(aired > 0 && selected.size >= aired)
  function toggleAllAired() { selected = allAiredSelected ? new Set() : new Set(airedList) }
  function confirmDownload() {
    if (!selected.size && followNew === !!subscription) return
    if (selected.size) {
      enqueueMany(media, [...selected].sort((a, b) => a - b), {
        quality: $downloadQuality,
        cachedOnly: $downloadCachedOnly,
        audio: $downloadAudio,
        codec: $downloadCodec,
      })
    }
    if (followNew) subscribeAutoDownloads(media, subscription?.nextEpisode ?? aired + 1)
    else if (subscription) removeAutoDownloadForMedia(media.id)
    cancelSelect()
  }

  function countdown(sec?: number) {
    if (!sec) return ''
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
</script>

{#if total > 0}
  {#if playState.status === 'error'}
    <p class="mb-3 text-sm text-destructive">{playState.message}</p>
  {/if}

  {#if aired > 0}
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <label class="relative min-w-52 flex-1 sm:max-w-sm">
        <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          bind:value={episodeQuery}
          data-focusable
          placeholder="Find episode number or title…"
          class="w-full rounded-md bg-input py-2 pl-9 pr-3 text-sm"
        />
      </label>
      <button data-focusable onclick={randomEpisode}
              class="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">
        <Shuffle size={15} /> Random
      </button>
      <details class="relative">
        <summary data-focusable class="flex cursor-pointer list-none items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">
          <ListChecks size={15} /> Progress tools
        </summary>
        <div class="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-2xl">
          <label class="text-xs font-bold text-muted-foreground" for="progress-through">Watched through episode</label>
          <div class="mt-1 flex gap-2">
            <input id="progress-through" data-focusable type="number" min="0" max={aired} bind:value={progressTarget}
                   class="min-w-0 flex-1 rounded-md bg-input px-3 py-2 text-sm" />
            <button data-focusable onclick={applyProgress}
                    class="rounded-md bg-primary px-3 py-2 text-xs font-black text-primary-foreground">Save</button>
          </div>
          <button data-focusable onclick={clearProgress}
                  class="mt-2 w-full rounded-md border border-border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-accent">
            Mark season unwatched
          </button>
          {#if progressStatus}<p class="mt-2 text-[0.68rem] text-muted-foreground">{progressStatus}</p>{/if}
        </div>
      </details>
    </div>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      {#if !selecting}
        <div class="flex rounded-lg bg-secondary p-0.5 text-sm font-bold">
          <button data-focusable onclick={() => toggleSort('asc')}
                  class="rounded-md px-3 py-1 transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
          <button data-focusable onclick={() => toggleSort('desc')}
                  class="rounded-md px-3 py-1 transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
        </div>
        {#if absoluteAvailable}
          <div class="flex rounded-lg bg-secondary p-0.5 text-sm font-bold">
            <button data-focusable onclick={() => (numberMode = 'series')}
                    class="rounded-md px-3 py-1 {numberMode === 'series' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Series #</button>
            <button data-focusable onclick={() => (numberMode = 'absolute')}
                    class="rounded-md px-3 py-1 {numberMode === 'absolute' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Absolute #</button>
          </div>
        {/if}
        {#if !offline}
          <button data-focusable onclick={startSelect}
                  class="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-bold transition-colors hover:bg-accent">
            <Download size={15} /> Download…
          </button>
        {/if}
      {:else}
        <span class="mr-1 text-sm font-bold text-muted-foreground">
          {selected.size ? `${selected.size} selected` : 'Select episodes'}
        </span>
        <button data-focusable onclick={toggleAllAired}
                class="rounded-md bg-secondary px-3 py-1.5 text-sm font-bold transition-colors hover:bg-accent">
          {allAiredSelected ? 'Clear' : `All aired (${aired})`}
        </button>
        <label class="flex cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-bold">
          <input data-focusable type="checkbox" bind:checked={followNew} />
          Auto-download new episodes
        </label>
        <a data-focusable href="/app/settings/downloads" class="text-xs font-bold text-theme hover:underline">Matching settings</a>
        <button data-focusable disabled={!selected.size && followNew === !!subscription} onclick={confirmDownload}
                class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40">
          <Download size={15} /> Apply{selected.size ? ` · Download ${selected.size}` : ''}
        </button>
        <button data-focusable onclick={cancelSelect}
                class="ml-auto rounded-md px-3 py-1.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Cancel
        </button>
      {/if}
    </div>
    {#if !selecting && subscription}
      <p class="mb-3 text-xs font-bold text-theme">Auto-download is watching for episode {subscription.nextEpisode}.</p>
    {/if}
  {/if}

  {#if metaLoading}
    <!-- Immediate skeleton grid (shape matches the setting) so the list appears at
         once and doesn't flip layouts; real cards then fade their thumbnails in. -->
    {#if $episodeLayout === 'cards'}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {#each eps as ep (ep)}
          <div class="overflow-hidden rounded-lg bg-secondary">
            <div class="aspect-video w-full skeloader"></div>
            <div class="p-2"><div class="skeloader h-3.5 w-2/3 rounded"></div></div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {#each eps as ep (ep)}
          <div class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2">
            <div class="skeloader size-8 shrink-0 rounded"></div>
            <div class="skeloader h-3.5 flex-1 rounded"></div>
          </div>
        {/each}
      </div>
    {/if}
  {:else if $episodeLayout === 'cards'}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
      {#each rows as ep (ep)}
        <EpisodeCard
          {media}
          {ep}
          meta={meta[ep]}
          showThumb={showThumbs && !!meta[ep]?.image}
          released={ep <= aired}
          isNext={next?.episode === ep}
          {watchedThrough}
          filler={fillerSet.has(ep)}
          dl={$downloads[keyFor(media.id, ep)]}
          {next}
          {selecting}
          selectedEp={selected.has(ep)}
          numberLabel={numberLabel(ep)}
          onplay={tap}
        />
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
      {#each rows as ep (ep)}
        {@const released = ep <= aired}
        {@const isNext = next?.episode === ep}
        {@const filler = fillerSet.has(ep)}
        {@const dl = $downloads[keyFor(media.id, ep)]}
        {@const sel = selecting && selected.has(ep)}
        {@const labels = episodeLabels(ep, meta[ep]?.title, $hideSpoilers && watchedThrough < ep)}
        <div
          data-focusable
          role="button"
          tabindex="0"
          aria-disabled={!released || resolving}
          aria-pressed={selecting ? sel : undefined}
          onclick={() => { if (!resolving) { h.tap(); tap(ep) } }}
          onkeydown={(e) => { if (!resolving && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap(ep) } }}
          title={selecting ? (released ? (sel ? 'Selected — tap to unselect' : 'Tap to select') : 'Not yet aired') : released ? `Play episode ${ep}${filler ? ' (filler)' : ''}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
          class="group flex items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors sm:px-3 sm:py-2
            {released ? 'cursor-pointer bg-secondary hover:bg-accent' : 'cursor-not-allowed bg-background/40 opacity-60'} {filler ? 'ring-1 ring-yellow-400/70' : ''} {sel ? 'ring-2 ring-primary' : ''}"
        >
          {#if selecting && released}
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors {sel ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 text-transparent'}">
              <Check size={16} />
            </span>
          {:else}
            <span class="grid h-7 min-w-7 shrink-0 place-items-center rounded bg-background/40 px-1 text-sm font-black sm:h-8 sm:min-w-8">{numberLabel(ep)}</span>
          {/if}
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="truncate text-sm font-bold">{labels.primary}</span>
              {#if filler}<span class="shrink-0 rounded bg-yellow-400 px-1 text-[0.6rem] font-bold text-black">FILLER</span>{/if}
              {#if dl?.status === 'done'}<span class="shrink-0 rounded bg-green-500/20 px-1 text-[0.55rem] font-bold text-green-400">SAVED</span>{/if}
            </span>
            {#if isNext}
              <span class="block text-[0.7rem] font-bold text-theme">airing in {countdown(next?.timeUntilAiring)}</span>
            {:else if !released}
              <span class="block text-[0.7rem] text-muted-foreground">Not aired</span>
            {/if}
          </span>
          <!-- Read-only download status (the trigger now lives in the header's select mode). -->
          {#if dl && !selecting}
            <span class="grid size-7 shrink-0 place-items-center rounded-full bg-background/40" title="Download {dl.status}">
              {#if dl.status === 'error'}<Download size={13} class="text-destructive" />
              {:else if dl.status === 'done'}<Check size={13} class="text-green-400" />
              {:else if dl.status === 'downloading'}<span class="text-[0.55rem] font-black tabular-nums text-blue-400">{dl.bytes ? Math.round((dl.downloaded / dl.bytes) * 100) : 0}</span>
              {:else if dl.status === 'queued'}<Loader size={13} class="animate-spin text-muted-foreground" />
              {:else}<Pause size={12} class="text-amber-400" />{/if}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if pages > 1 && !searchedEpisodes}
    <div class="mt-4 flex items-center gap-3 text-sm">
      <button data-focusable disabled={curPage === 0} onclick={() => (page = curPage - 1)}
              class="rounded bg-secondary px-4 py-2.5 disabled:opacity-40 sm:py-1">Prev</button>
      <span class="text-muted-foreground">Episodes {startIdx + 1}–{startIdx + eps.length} of {total} · page {curPage + 1}/{pages}</span>
      <button data-focusable disabled={curPage >= pages - 1} onclick={() => (page = curPage + 1)}
              class="rounded bg-secondary px-4 py-2.5 disabled:opacity-40 sm:py-1">Next</button>
    </div>
  {/if}
{:else if next?.episode}
  <p class="text-sm text-muted-foreground">Episode 1 airing in {countdown(next.timeUntilAiring)}</p>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}
