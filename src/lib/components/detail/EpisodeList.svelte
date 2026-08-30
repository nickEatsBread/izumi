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
    absoluteEpisodeNumbers, type Quality, type EpisodeLayout,
  } from '$lib/settings/ui'
  import { localHistory, sessionProgress, manualProgressOverrides } from '$lib/player/history'
  import { markWatched } from '$lib/trackers'
  import { positions, progressKey, episodeBarPercent } from '$lib/player/progress'
  import { episodeLabels, episodeNumberLabel } from '$lib/anilist/episode-labels'
  import { fillerEpisodes } from '$lib/anime/filler'
  import { orderEpisodes, type SortDir } from '$lib/anime/episode-order'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import { enqueueMany, downloads, keyFor } from '$lib/downloads/store'
  import {
    autoDownloadRules, removeAutoDownloadForMedia, subscribeAutoDownloads,
  } from '$lib/downloads/rules'
  import EpisodeCard from './EpisodeCard.svelte'
  import AiringStatus from './AiringStatus.svelte'
  import { episodeTileState } from './episode-tile'
  import Download from '@lucide/svelte/icons/download'
  import Loader from '@lucide/svelte/icons/loader-circle'
  import Pause from '@lucide/svelte/icons/pause'
  import Check from '@lucide/svelte/icons/check'
  import Search from '@lucide/svelte/icons/search'
  import Shuffle from '@lucide/svelte/icons/shuffle'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Rows3 from '@lucide/svelte/icons/rows-3'
  import ListPlus from '@lucide/svelte/icons/list-plus'
  import { enqueueEpisode } from '$lib/library/local-lists'
  import { m } from '$lib/paraglide/messages.js'
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
  let searchOpen = $state(false)
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
  const rows = $derived(orderEpisodes(eps, sortDir))
  // The controller fast lane targets the episode the hero CTA would use. `autoPage` already keeps
  // that episode on-screen for long-runners; the fallback covers unusual offline/schedule data.
  // This target is semantic rather than geometric, so a single Down never detours through search,
  // sort, tabs, or release metadata merely because those controls happen to sit between the rows.
  const quickEpisode = $derived.by(() => {
    const preferred = offline
      ? (offlineEps.find((episode) => episode > watchedThrough) ?? offlineEps[0])
      : Math.max(1, Math.min(watchedThrough + 1, aired || 1))
    return rows.includes(preferred) ? preferred : (rows.find((episode) => episode <= aired) ?? rows[0])
  })
  function toggleSort(dir: SortDir) { if (dir !== sortDir) { h.select(); sortDir = dir } }

  // The switch is binary but the preference is ternary: `compact` is only reachable from Settings.
  // Remember which non-grid layout the user actually has so toggling back restores THAT, instead of
  // silently overwriting a compact preference with cards.
  let lastNonGrid: EpisodeLayout = $episodeLayout === 'grid' ? 'cards' : $episodeLayout
  function setLayout(next: 'list' | 'grid') {
    const target = next === 'grid' ? 'grid' : lastNonGrid
    if ($episodeLayout === target) return
    if ($episodeLayout !== 'grid') lastNonGrid = $episodeLayout
    h.select()
    episodeLayout.set(target)
  }

  // Per-episode metadata from AniZip (thumbnail/title/rating). Best-effort; the
  // cards fall back to the show art when a given episode has no entry.
  let meta = $state<Record<number, EpMeta>>({})
  let metaLoading = $state(true)
  $effect(() => {
    if (offline) { meta = {}; metaLoading = false; return } // no per-episode metadata fetch offline
    let cancelled = false
    metaLoading = true
    const applyMeta = (m: Record<number, EpMeta>) => { if (!cancelled) { meta = m; metaLoading = false } }
    getEpisodeMeta(media.id, watchedThrough, applyMeta).then(applyMeta)
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
  // Series-wide numbering is a Settings → Interface preference, not a control on this page. The
  // per-episode `abs` mapping is still loaded and still available to everything that needs it —
  // this only decides which number the badge prints.
  const numberLabel = (episode: number) => episodeNumberLabel(episode, meta[episode]?.abs, $absoluteEpisodeNumbers)

  function randomEpisode() {
    if (aired < 1 || resolving) return
    play(1 + Math.floor(Math.random() * aired))
  }
  const nextQueueEpisode = $derived(Math.max(1, Math.min(watchedThrough + 1, aired || 1)))
  let queuedNotice = $state(false)
  function queueEpisode(episode: number) {
    enqueueEpisode(media, episode)
    h.select()
    queuedNotice = true
    setTimeout(() => (queuedNotice = false), 1800)
  }
  function queueNextEpisode() {
    if (aired < 1) return
    queueEpisode(nextQueueEpisode)
  }

  // Downloads are a deliberate MULTI-SELECT mode instead of a per-episode button under
  // every card (which doubled the D-pad stops and cluttered the grid). A "Download" button
  // enters select mode: tapping episodes toggles them, then one action queues the batch.
  let selecting = $state(false)
  let selected = $state<Set<number>>(new Set())
  let followNew = $state(false)
  // Per-batch overrides for this select-mode session only — seeded from the Settings → Downloads
  // globals each time select mode starts, but never written back. Lets a one-off batch (e.g. "just
  // the dub of this arc") diverge from the standing default without touching it.
  let batchQuality = $state<Quality>('any')
  let batchAudio = $state<'any' | 'sub' | 'dub'>('any')
  let batchCodec = $state<'any' | 'h264' | 'h265' | 'av1'>('any')
  const airedList = $derived(Array.from({ length: aired }, (_, i) => i + 1))
  const subscription = $derived($autoDownloadRules.find((rule) => rule.mediaId === media.id))
  // A tap on a released episode plays it — or, in select mode, toggles its selection. On desktop,
  // Shift+click marks the series watched through that episode without opening the player.
  // Upcoming (unaired) episodes are neither playable nor selectable.
  function tap(ep: number, event?: MouseEvent) {
    if (ep > aired) return
    if (!selecting) {
      if (event?.shiftKey) { markWatched(media, ep); return }
      play(ep)
      return
    }
    const n = new Set(selected)
    n.has(ep) ? n.delete(ep) : n.add(ep)
    selected = n
  }
  function startSelect() {
    selecting = true; selected = new Set(); followNew = !!subscription
    batchQuality = $downloadQuality; batchAudio = $downloadAudio; batchCodec = $downloadCodec
  }
  function cancelSelect() { selecting = false; selected = new Set(); followNew = false }
  const allAiredSelected = $derived(aired > 0 && selected.size >= aired)
  function toggleAllAired() { h.select(); selected = allAiredSelected ? new Set() : new Set(airedList) }
  // One-line echo of the current batch pickers (used as a tooltip on the "Defaults" link now that
  // the pickers themselves are inline controls, not read-only text).
  const AUDIO_LABEL = { any: 'Any audio', sub: 'Subbed', dub: 'Dubbed' } as const
  const matchSummary = $derived(
    [
      batchQuality === 'any' ? 'Any quality' : `${batchQuality}p`,
      AUDIO_LABEL[batchAudio],
      batchCodec === 'any' ? null : batchCodec.toUpperCase(),
      $downloadCachedOnly ? 'Cached only' : null,
    ].filter(Boolean).join(' · '),
  )
  // Nothing to apply unless episodes are picked or the auto-download subscription actually changed.
  const applyDisabled = $derived(!selected.size && followNew === !!subscription)
  const applyLabel = $derived(
    selected.size
      ? `Download ${selected.size} episode${selected.size === 1 ? '' : 's'}`
      : followNew !== !!subscription
        ? (followNew ? 'Turn on auto-download' : 'Turn off auto-download')
        : 'Tap episodes to select',
  )
  function confirmDownload() {
    if (!selected.size && followNew === !!subscription) return
    if (selected.size) {
      enqueueMany(media, [...selected].sort((a, b) => a - b), {
        quality: batchQuality,
        cachedOnly: $downloadCachedOnly,
        audio: batchAudio,
        codec: batchCodec,
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
    <div class="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      {#if !$isMobile}
      {#if !selecting}
        <div class="flex rounded-lg bg-secondary p-0.5 text-sm font-bold">
          <button data-focusable onclick={() => toggleSort('asc')}
                  class="rounded-md px-3 py-1.5 transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
          <button data-focusable onclick={() => toggleSort('desc')}
                  class="rounded-md px-3 py-1.5 transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
        </div>
      {/if}
      <label class="relative col-span-2 min-w-0 sm:max-w-sm sm:flex-1">
        <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          bind:value={episodeQuery}
          data-focusable
          placeholder="Find episode number or title…"
          class="h-12 w-full rounded-xl bg-input pl-10 pr-3 text-base sm:h-auto sm:rounded-md sm:py-2 sm:pl-9 sm:text-sm"
        />
      </label>
      {/if}
      {#if $isMobile}
        <div class="flex min-h-11 w-full items-stretch rounded-xl bg-secondary p-1 text-sm font-bold">
          <button data-focusable onclick={() => toggleSort('asc')}
                  class="flex min-h-9 flex-1 items-center justify-center rounded-lg px-3 leading-none transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
          <button data-focusable onclick={() => toggleSort('desc')}
                  class="flex min-h-9 flex-1 items-center justify-center rounded-lg px-3 leading-none transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
        </div>
      {:else}
        <button data-focusable onclick={randomEpisode}
                class="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold hover:bg-accent sm:h-auto sm:rounded-md sm:py-2">
          <Shuffle size={15} /> Random
        </button>
        <button data-focusable onclick={queueNextEpisode} disabled={aired < 1}
                title={`${m.lists_add_queue()} — Episode ${nextQueueEpisode}`}
                class="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold hover:bg-accent disabled:opacity-40 sm:h-auto sm:rounded-md sm:py-2">
          <ListPlus size={15} /> {queuedNotice ? m.lists_queued_episode({ episode: nextQueueEpisode }) : m.lists_add_queue()}
        </button>
        {#if !selecting}
          {#if !offline}
            <button data-focusable onclick={startSelect}
                    class="flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
              <Download size={15} /> Download…
            </button>
          {/if}
        {/if}
      {/if}
      {#if $isMobile}
        <button data-focusable onclick={queueNextEpisode} disabled={aired < 1}
                class="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold disabled:opacity-40">
          <ListPlus size={16} /> {m.lists_add_queue()}
        </button>
        <!-- Layout switch: mobile-only. Rendering it unconditionally added two data-focusable
             stops to the desktop toolbar and the Deck's controller focus order for a layout that
             doesn't apply there. -->
        <div role="group" aria-label="Episode layout"
             class="flex min-h-11 items-stretch rounded-xl bg-secondary p-1">
          <button data-focusable onclick={() => setLayout('list')} aria-label="Episode cards"
                  aria-pressed={$episodeLayout !== 'grid'}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {$episodeLayout !== 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <Rows3 size={17} />
          </button>
          <button data-focusable onclick={() => setLayout('grid')} aria-label="Episode numbers"
                  aria-pressed={$episodeLayout === 'grid'}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {$episodeLayout === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <LayoutGrid size={17} />
          </button>
          <button data-focusable onclick={() => { h.tap(); searchOpen = !searchOpen; if (!searchOpen) episodeQuery = '' }}
                  aria-label="Search episodes" aria-pressed={searchOpen}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {searchOpen ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <Search size={17} />
          </button>
        </div>
      {/if}
      {#if !$isMobile && !selecting}
        <!-- Release timing belongs to episode controls, not series navigation. `ml-auto` keeps it
             at the opposite edge from the actions; if the toolbar wraps, it remains right-aligned. -->
        <div class="col-span-2 ml-auto flex shrink-0 items-center gap-3">
          <AiringStatus {media} toolbar />
        </div>
      {/if}
    </div>
    {#if $isMobile && searchOpen}
      <label class="relative mb-4 block min-w-0">
        <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input bind:value={episodeQuery} data-focusable placeholder="Find episode number or title…"
               class="h-12 w-full rounded-xl bg-input pl-10 pr-3 text-base" />
      </label>
    {/if}
    {#if selecting && $isMobile}
      <!-- Mobile select mode. The desktop toolbar is a row of chips of mismatched heights; dropped
           into the 2-column mobile grid it wrapped into a scattered mess (a bare label sharing a row
           with a button, a tiny text link floating next to a checkbox). On mobile it's one panel of
           full-width rows in reading order — count/cancel, select-all, auto-download, what will be
           matched — with the primary action pinned to a bottom bar so it stays under the thumb while
           you scroll the grid tapping episodes. -->
      <div class="mb-4 rounded-xl border border-border bg-card p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-base font-black leading-tight">{selected.size ? `${selected.size} selected` : 'Select episodes'}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">Tap episodes below to pick them.</p>
          </div>
          <button data-focusable onclick={cancelSelect}
                  class="-mr-1 -mt-1 flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-bold text-muted-foreground transition-colors active:bg-accent">
            Cancel
          </button>
        </div>
        <button data-focusable onclick={toggleAllAired}
                class="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-sm font-bold transition-colors active:bg-accent">
          <ListChecks size={16} /> {allAiredSelected ? 'Clear selection' : `Select all aired (${aired})`}
        </button>
        <label class="mt-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg bg-secondary px-3 py-2 text-sm font-bold">
          <input data-focusable type="checkbox" bind:checked={followNew} class="size-5 shrink-0 accent-theme" />
          <span class="flex-1">Auto-download new episodes</span>
        </label>
        <!-- flex-wrap + a real min width on the selects: flex-1 alone has basis 0% and would let
             narrow phones crush both selects to ~20px instead of wrapping the row. -->
        <div class="mt-2 flex flex-wrap items-center gap-2 px-1">
          <select data-focusable bind:value={batchQuality}
                  aria-label="Batch quality"
                  class="h-9 min-w-[6rem] flex-1 rounded-lg bg-secondary px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-accent">
            <option value="any">Any quality</option>
            <option value="2160">2160p</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
          </select>
          <div class="flex h-9 shrink-0 items-stretch rounded-lg bg-secondary p-0.5 text-xs font-bold">
            <button type="button" data-focusable onclick={() => (batchAudio = 'any')}
                    class="h-full rounded-md px-2 leading-none transition-colors {batchAudio === 'any' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Any</button>
            <button type="button" data-focusable onclick={() => (batchAudio = 'sub')}
                    class="h-full rounded-md px-2 leading-none transition-colors {batchAudio === 'sub' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Sub</button>
            <button type="button" data-focusable onclick={() => (batchAudio = 'dub')}
                    class="h-full rounded-md px-2 leading-none transition-colors {batchAudio === 'dub' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Dub</button>
          </div>
          <select data-focusable bind:value={batchCodec}
                  aria-label="Batch codec"
                  class="h-9 min-w-[6rem] flex-1 rounded-lg bg-secondary px-2 text-xs font-bold outline-none focus:ring-2 focus:ring-accent">
            <option value="any">Any codec</option>
            <option value="h264">H264</option>
            <option value="h265">H265</option>
            <option value="av1">AV1</option>
          </select>
          <a data-focusable href="/app/settings/downloads" title={matchSummary} class="shrink-0 rounded px-1 py-1 text-xs font-bold text-theme">Defaults</a>
        </div>
      </div>
    {:else if selecting || ($isMobile && !offline)}
    <div class="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      {#if !selecting}
        <button data-focusable onclick={startSelect}
                class="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold transition-colors hover:bg-accent">
          <Download size={15} /> Download…
        </button>
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
        <select data-focusable bind:value={batchQuality}
                aria-label="Batch quality"
                class="h-9 rounded-md bg-secondary px-2 text-sm font-bold outline-none focus:ring-2 focus:ring-accent">
          <option value="any">Any quality</option>
          <option value="2160">2160p</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
        </select>
        <div class="flex h-9 items-stretch rounded-md bg-secondary p-0.5 text-sm font-bold">
          <button type="button" data-focusable onclick={() => (batchAudio = 'any')}
                  class="h-full rounded px-2 leading-none transition-colors {batchAudio === 'any' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Any</button>
          <button type="button" data-focusable onclick={() => (batchAudio = 'sub')}
                  class="h-full rounded px-2 leading-none transition-colors {batchAudio === 'sub' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Sub</button>
          <button type="button" data-focusable onclick={() => (batchAudio = 'dub')}
                  class="h-full rounded px-2 leading-none transition-colors {batchAudio === 'dub' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Dub</button>
        </div>
        <select data-focusable bind:value={batchCodec}
                aria-label="Batch codec"
                class="h-9 rounded-md bg-secondary px-2 text-sm font-bold outline-none focus:ring-2 focus:ring-accent">
          <option value="any">Any codec</option>
          <option value="h264">H264</option>
          <option value="h265">H265</option>
          <option value="av1">AV1</option>
        </select>
        <a data-focusable href="/app/settings/downloads" title={matchSummary}
           class="text-sm font-bold text-theme hover:underline">Defaults</a>
        <button data-focusable disabled={applyDisabled} onclick={confirmDownload}
                class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40">
          <Download size={15} /> {applyLabel}
        </button>
        <button data-focusable onclick={cancelSelect}
                class="ml-auto rounded-md px-3 py-1.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          Cancel
        </button>
      {/if}
    </div>
    {/if}
    {#if !selecting && subscription}
      <p class="mb-3 text-xs font-bold text-theme">Auto-download is watching for episode {subscription.nextEpisode}.</p>
    {/if}
  {/if}

  {#if metaLoading}
    <!-- Immediate skeleton grid (shape matches the setting) so the list appears at
         once and doesn't flip layouts; real cards then fade their thumbnails in. -->
    {#if $episodeLayout === 'cards'}
      <div class="grid select-none grid-cols-1 gap-3 min-[500px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {#each eps as ep (ep)}
          <button data-focusable={ep === quickEpisode ? '' : undefined}
                  data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                  data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                  tabindex={ep === quickEpisode ? 0 : -1} disabled={ep !== quickEpisode}
                  onclick={(event) => tap(ep, event)} aria-label={`Play episode ${numberLabel(ep)}`}
                  class="grid grid-cols-[42%_1fr] overflow-hidden rounded-xl bg-secondary text-left sm:block sm:rounded-lg disabled:opacity-100">
            <div class="aspect-video h-full w-full skeloader"></div>
            <div class="flex items-center p-3 sm:block sm:p-2"><div class="skeloader h-3.5 w-2/3 rounded"></div></div>
          </button>
        {/each}
      </div>
    {:else if $episodeLayout === 'grid'}
      <div class="grid select-none grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2">
        {#each eps as ep (ep)}
          <button data-focusable={ep === quickEpisode ? '' : undefined}
                  data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                  data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                  tabindex={ep === quickEpisode ? 0 : -1} disabled={ep !== quickEpisode}
                  onclick={(event) => tap(ep, event)} aria-label={`Play episode ${numberLabel(ep)}`}
                  class="skeloader h-11 rounded-lg disabled:opacity-100"></button>
        {/each}
      </div>
    {:else}
      <div class="grid select-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {#each eps as ep (ep)}
          <button data-focusable={ep === quickEpisode ? '' : undefined}
                  data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                  data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                  tabindex={ep === quickEpisode ? 0 : -1} disabled={ep !== quickEpisode}
                  onclick={(event) => tap(ep, event)} aria-label={`Play episode ${numberLabel(ep)}`}
                  class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2 text-left disabled:opacity-100">
            <div class="skeloader size-8 shrink-0 rounded"></div>
            <div class="skeloader h-3.5 flex-1 rounded"></div>
          </button>
        {/each}
      </div>
    {/if}
  {:else if $episodeLayout === 'grid'}
    <!-- Dense number tiles: a compact shape for browsing long-runners at a glance. Tile states
         mirror what a card shows, so switching layouts never changes what the list is telling you. -->
    <div class="grid select-none grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2">
      {#each rows as ep (ep)}
        {@const tile = episodeTileState({
          ep,
          watchedThrough,
          aired,
          percent: episodeBarPercent($positions[progressKey(media.id, ep)], false, ep <= aired),
        })}
        <button data-focusable data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                disabled={!tile.playable} onclick={(event) => { h.tap(); tap(ep, event) }}
                aria-label={`Episode ${numberLabel(ep)}`}
                class="relative grid h-11 place-items-center overflow-hidden rounded-lg text-sm font-bold transition-colors
                  {tile.kind === 'watched' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}
                  {tile.kind === 'resume' ? 'ring-2 ring-theme' : ''}
                  {selecting && selected.has(ep) ? 'ring-2 ring-primary' : ''}
                  {tile.kind === 'unaired' ? 'opacity-40' : 'active:bg-accent'}">
          {numberLabel(ep)}
          {#if tile.kind === 'partial'}
            <span class="absolute inset-x-0 bottom-0 h-1 bg-theme" style="width:{tile.percent}%"></span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if $episodeLayout === 'cards'}
    <div class="grid select-none grid-cols-1 gap-3 min-[500px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
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
          navId={ep === quickEpisode ? 'series-quick-episode' : undefined}
          navUp={ep === quickEpisode ? 'series-primary-action' : undefined}
          onplay={tap}
          onqueue={queueEpisode}
        />
      {/each}
    </div>
  {:else}
    <div class="grid select-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
      {#each rows as ep (ep)}
        {@const released = ep <= aired}
        {@const isNext = next?.episode === ep}
        {@const filler = fillerSet.has(ep)}
        {@const dl = $downloads[keyFor(media.id, ep)]}
        {@const sel = selecting && selected.has(ep)}
        {@const labels = episodeLabels(ep, meta[ep]?.title, $hideSpoilers && watchedThrough < ep)}
        <!-- Watched state, same derivation the cards use. The compact layout previously read
             `watchedThrough` ONLY to blur spoilers, so a fully-watched season looked completely
             unwatched here while the card layout showed every episode finished. -->
        {@const done = watchedThrough >= ep}
        {@const pct = episodeBarPercent($positions[progressKey(media.id, ep)], done, released)}
        <div
          data-focusable
          data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
          data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
          role="button"
          tabindex="0"
          aria-disabled={!released || resolving}
          aria-pressed={selecting ? sel : undefined}
          onclick={(event) => { if (!resolving) { h.tap(); tap(ep, event) } }}
          onkeydown={(e) => { if (!resolving && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap(ep) } }}
          title={selecting ? (released ? (sel ? 'Selected — tap to unselect' : 'Tap to select') : 'Not yet aired') : released ? `Play episode ${ep}${filler ? ' (filler)' : ''}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
          class="group relative flex items-center gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-left transition-colors sm:px-3 sm:py-2
            {released ? 'cursor-pointer bg-secondary hover:bg-accent' : 'cursor-not-allowed bg-background/40 opacity-60'} {filler ? 'ring-1 ring-yellow-400/70' : ''} {sel ? 'ring-2 ring-primary' : ''}"
        >
          {#if selecting && released}
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors {sel ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 text-transparent'}">
              <Check size={16} />
            </span>
          {:else}
            <!-- The number chip carries the watched state: it stays a NUMBER (identity is what you
                 scan for in this layout) but takes the theme tint, so a finished season reads as
                 finished at a glance without hiding which episode is which. -->
            <span class="grid h-7 min-w-7 shrink-0 place-items-center rounded px-1 text-sm font-black sm:h-8 sm:min-w-8 {done ? 'bg-theme/25 text-theme' : 'bg-background/40'}">{numberLabel(ep)}</span>
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
          {#if released && !selecting}
            <button data-focusable onclick={(event) => { event.stopPropagation(); queueEpisode(ep) }}
              aria-label={m.lists_queue_episode({ episode: ep })} title={m.lists_queue_episode({ episode: ep })}
              class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <ListPlus size={14} />
            </button>
          {/if}
          <!-- Resume/watched bar, identical to the card layout: a real saved position wins, and a
               tracker-counted episode fills it as the fallback. -->
          {#if pct > 0 && !selecting}
            <span class="absolute inset-x-0 bottom-0 h-0.5 bg-white/15"><span class="block h-full bg-theme" style={`width:${pct}%`}></span></span>
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

  {#if selecting && $isMobile}
    <!-- Sits above the bottom tab bar (z-30) and is taller than it, so select mode owns the bottom
         edge exactly like an Android contextual action bar — you can't navigate away mid-selection
         by mis-tapping a tab. The spacer keeps the last episode row and the pager clear of it. -->
    <div class="h-28" aria-hidden="true"></div>
    <div class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pt-3 backdrop-blur"
         style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));">
      <button data-focusable disabled={applyDisabled} onclick={confirmDownload}
              class="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-black text-primary-foreground transition-opacity active:opacity-90 disabled:opacity-40">
        <Download size={17} /> {applyLabel}
      </button>
    </div>
  {/if}
{:else if next?.episode}
  <p class="text-sm text-muted-foreground">Episode 1 airing in {countdown(next.timeUntilAiring)}</p>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}
