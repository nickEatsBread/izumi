<script lang="ts">
  // Episode grid. Only *aired* episodes are playable (aired = nextAiringEpisode-1,
  // not the planned total). Upcoming episodes render greyed with an air countdown
  // for the next one. Long-runners (One Piece) are paginated. The layout (rich
  // `cards` vs simple `compact` rows) follows the persisted Appearance setting;
  // per-episode thumbnails/titles/ratings come from AniZip.
  import { untrack } from 'svelte'
  import { playEpisode, prefetchEpisodeSources, resumeEpisode, type PlayState } from '$lib/stremio/play'
  import { airedCount, cover } from '$lib/anilist/media'
  import { animeEpisodeNumbers, animeEpisodeMetadata, animeResumeEpisode, animeWatchedProgress } from '$lib/catalog/anime-detail'
  import { anilistIdOf } from '$lib/catalog/identity'
  import type { Media } from '$lib/anilist/types'
  import { getEpisodeMeta } from '$lib/anizip'
  import type { EpMeta } from '$lib/anizip/types'
  import {
    episodeLayout, hideSpoilers, downloadQuality, downloadAudio, downloadCodec, downloadCachedOnly,
    absoluteEpisodeNumbers, episodeQueueEnabled, type Quality, type EpisodeLayout,
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
  import EpisodeToolbar from './EpisodeToolbar.svelte'
  import { planEpisodeToolbar } from './toolbar-plan'
  import SeasonPicker from './SeasonPicker.svelte'
  import { fetchSeasonChain, seasonEntries, type SeasonEntry } from '$lib/anilist/seasons'
  import AiringStatus from './AiringStatus.svelte'
  import { episodeTileState, offlineResumeEpisode, playableThrough } from './episode-tile'
  import { episodeRanges, pageSizeFor, searchEpisodes, shownPage } from './episode-ranges'
  import { episodeNoText } from '$lib/themes/episode-fields'
  import Download from '@lucide/svelte/icons/download'
  import Loader from '@lucide/svelte/icons/loader-circle'
  import Pause from '@lucide/svelte/icons/pause'
  import Check from '@lucide/svelte/icons/check'
  import Search from '@lucide/svelte/icons/search'
  import ArrowDown01 from '@lucide/svelte/icons/arrow-down-0-1'
  import ArrowUp10 from '@lucide/svelte/icons/arrow-up-1-0'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Rows3 from '@lucide/svelte/icons/rows-3'
  import ListPlus from '@lucide/svelte/icons/list-plus'
  import Play from '@lucide/svelte/icons/play'
  import { enqueueEpisode } from '$lib/library/local-lists'
  import { m } from '$lib/paraglide/messages.js'
  import { themePresentation } from '$lib/themes/runtime'
  import { episodesOnSide, resolveDetail } from '$lib/themes/presentation'
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
  const allEpisodes = $derived(offline ? offlineEps : animeEpisodeNumbers(media))
  const total = $derived(allEpisodes.length)
  // aired = last episode that has already aired, never more than the total. airedCount can
  // be Infinity when the count is genuinely unknown — that is not permission to expose a
  // provider's planned total, so keep every episode gated until release metadata arrives.
  // Offline: every downloaded episode is playable, so aired = the highest downloaded number.
  const aired = $derived(playableThrough(allEpisodes, airedCount(media), offline))
  const watchedThrough = $derived(animeWatchedProgress(media, $localHistory, $sessionProgress, $manualProgressOverrides))
  const episodeTheme = $derived(resolveDetail($themePresentation).episodes)
  const episodeCard = $derived(episodeTheme?.card)
  const episodeListLayout = $derived(episodeTheme?.arrangement === 'list')
  const episodeCarousel = $derived(episodeTheme?.arrangement === 'carousel')
  const episodeGridLayout = $derived(episodeTheme?.arrangement === 'grid')
  const episodeHoverScale = $derived(episodeTheme?.hover === 'scale')
  const flipOrder = $derived(episodeTheme?.order === 'flip')
  const showEpisodeSearch = $derived(episodeTheme?.search !== false)
  // A theme's grid or carousel arrangement draws cards whatever the layout setting says, so the
  // cards/numbers switch would do nothing there.
  const layoutSwitch = $derived(episodeTheme?.arrangement !== 'grid' && episodeTheme?.arrangement !== 'carousel')
  const PER = $derived(pageSizeFor(total, episodeTheme?.pageSize))
  // `page` stays null until the user manually pages; until then we show `autoPage` — the page that
  // holds the next episode to watch — so opening a long-running series (One Piece) lands on where
  // you're up to, not episode 1. Deriving it (vs a one-shot init) keeps it right if progress
  // hydrates a tick late, and it stops following once the user hits Prev/Next.
  let page = $state<number | null>(null)
  const pages = $derived(Math.max(1, Math.ceil(total / PER)))
  const autoPage = $derived.by(() => {
    const next = allEpisodes.findIndex((episode) => episode > watchedThrough)
    return Math.max(0, Math.floor((next < 0 ? total - 1 : next) / PER))
  })
  // A picked page stays inside the list when the page size changes (`pageSize: "auto"` grows with it).
  const curPage = $derived(shownPage(page, autoPage, pages))
  const startIdx = $derived(curPage * PER)
  // Range chips (and Task 9's range picker) label pages by their printed first and last numbers.
  const rangeLabel = (episode: number) => episodeNoText(episode, meta[episode]?.abs, $absoluteEpisodeNumbers)
  const rangeChips = $derived(episodeTheme?.paging === 'ranges' ? episodeRanges(allEpisodes, PER, rangeLabel) : [])
  const rangeMenu = $derived(episodeTheme?.paging === 'dropdown' ? episodeRanges(allEpisodes, PER, rangeLabel, ' – ') : [])
  // `ranges` replaces the Prev/Next pager, and so does the toolbar's range picker once it shows.
  const pagerShown = $derived(episodeTheme?.paging !== 'ranges' && !(episodeTheme?.paging === 'dropdown' && aired > 0))
  let rangesRow = $state<HTMLElement>()
  // Keep the current range chip in view. Only the row scrolls: scrollIntoView would also move the
  // page down to the episodes as the tab opens.
  $effect(() => {
    const row = rangesRow
    const chip = row?.children[curPage] as HTMLElement | undefined
    if (row && chip) row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2)
  })
  let episodeQuery = $state('')
  let searchOpen = $state(false)
  // The whole list, not the current page: number matches first, then the rest (episode-ranges.ts).
  const searchedEpisodes = $derived.by(() => searchEpisodes(allEpisodes, episodeQuery, meta))
  const eps = $derived(
    searchedEpisodes ?? allEpisodes.slice(startIdx, startIdx + PER),
  )

  // Oldest/Newest toggle: reorders the current page's episodes for display. Pagination itself
  // still pages ascending (startIdx/PER above are unchanged) — see the note near the toggle.
  let sortDir = $state<SortDir>('asc')
  // `order: "none"` has no sort control, so the list is always oldest first.
  const dir = $derived<SortDir>(episodeTheme?.order === 'none' ? 'asc' : sortDir)
  // Search results keep their ranking; the sort orders pages.
  const rows = $derived(searchedEpisodes ? eps : orderEpisodes(eps, dir))
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
  // The episode the series Play button opens (the page CTA's own rule): `data-next` marks it for
  // theme stylesheets and the Continue card plays it. Offline: the next downloaded episode, by the
  // rule the Play button uses too (episode-tile.ts).
  const ctaEpisode = $derived(offline
    ? offlineResumeEpisode(offlineEps, watchedThrough)
    : animeResumeEpisode(media, watchedThrough))
  function toggleSort(dir: SortDir) { if (dir !== sortDir) { h.select(); sortDir = dir } }
  function flipSort() {
    h.select()
    sortDir = sortDir === 'asc' ? 'desc' : 'asc'
  }

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
    const supplied = animeEpisodeMetadata(media)
    meta = supplied
    const canonical = anilistIdOf(media)
    if (offline || canonical == null) { metaLoading = false; return }
    let cancelled = false
    metaLoading = !media.videos?.length
    const applyMeta = (m: Record<number, EpMeta>) => {
      if (cancelled) return
      const combined = { ...supplied }
      for (const [episode, details] of Object.entries(m)) {
        combined[Number(episode)] = { ...supplied[Number(episode)], ...Object.fromEntries(Object.entries(details).filter(([, value]) => value != null)) }
      }
      meta = combined; metaLoading = false
    }
    getEpisodeMeta(canonical, watchedThrough, applyMeta).then(applyMeta)
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
    const canonical = anilistIdOf(media)
    if (offline || canonical == null) { fillerSet = new Set(); return }
    let cancelled = false
    fillerEpisodes(canonical).then((list) => { if (!cancelled) fillerSet = new Set(list) })
    return () => { cancelled = true }
  })

  let playState = $state<PlayState>({ status: 'idle' })
  const resolving = $derived(playState.status === 'resolving')
  const intent = (ep: number, delayMs = 120) => { if (ep <= aired && !resolving) prefetchEpisodeSources(media, ep, delayMs) }
  function play(ep: number) {
    if (resolving) return
    intent(ep, 0)
    playEpisode(media, ep, (s) => (playState = s))
  }
  // API 3 `detail.continue: "card"`: the Continue card plays what the series Play button would,
  // through the same resume path (the remembered source first).
  const continueCard = $derived(resolveDetail($themePresentation).continue === 'card')
  function continueWatching() {
    if (resolving || aired < 1) return
    h.impact('medium')
    const target = ctaEpisode
    intent(target, 0)
    if (offline) playEpisode(media, target, (s) => (playState = s))
    else resumeEpisode(media, target, (s) => (playState = s))
  }
  // Series-wide numbering is a Settings → Interface preference, not a control on this page. The
  // per-episode `abs` mapping is still loaded and still available to everything that needs it —
  // this only decides which number the badge prints.
  const numberLabel = (episode: number) => episodeNumberLabel(episode, meta[episode]?.abs, $absoluteEpisodeNumbers)
  // The state every episode element carries (`data-state`): cards, rows and tiles share one rule.
  const stateOf = (ep: number) => episodeTileState({
    ep,
    watchedThrough,
    aired,
    percent: episodeBarPercent($positions[progressKey(media.id, ep)], false, ep <= aired),
  }).kind

  const nextQueueEpisode = $derived(allEpisodes.find((episode) => episode > watchedThrough && episode <= aired)
    ?? allEpisodes.find((episode) => episode <= aired) ?? 1)
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
  // Any toolbar key composes the theme's toolbar (EpisodeToolbar.svelte); without one izumi's own stays.
  // A flip order is the round button in the list's gutter on desktop beside a right-hand rail, and with
  // izumi's own toolbar (`plan.gutter`); inside the theme's toolbar elsewhere it is one toggle.
  const plan = $derived(planEpisodeToolbar({
    order: episodeTheme?.order,
    search: episodeTheme?.search,
    arrangement: episodeTheme?.arrangement,
    controls: episodeTheme?.controls,
    toolbar: episodeTheme?.toolbar,
    toolbarMin: episodeTheme?.toolbarMin,
    paging: episodeTheme?.paging,
    phone: $isMobile,
    offline,
    queueEnabled: $episodeQueueEnabled,
    selecting,
    total,
    rail: episodesOnSide($themePresentation, !$isMobile),
  }))
  // API 3 `detail.episodes.seasons`: this title's seasons above the list, from the AniList
  // prequel/sequel chain (cached per title, so moving between seasons does not walk it again).
  // Provider titles use their AniList mapping; offline pages show none.
  const seasonStyle = $derived(episodeTheme?.seasons ?? 'none')
  const seasonVariant = $derived<'chips' | 'posters' | 'dropdown'>(seasonStyle === 'none' ? 'chips' : seasonStyle)
  const seasonRoot = $derived(seasonStyle === 'none' || offline ? undefined : anilistIdOf(media))
  let seasonList = $state<SeasonEntry[]>([])
  $effect(() => {
    const root = seasonRoot
    if (root == null) { seasonList = []; return }
    const seed = untrack(() => (media.catalog ? undefined : media))
    let cancelled = false
    fetchSeasonChain(root, seed)
      .then((chain) => { if (!cancelled) seasonList = seasonEntries(chain, root) })
      .catch(() => {})
    return () => { cancelled = true }
  })
  // A heading-row toolbar takes the dropdown in place of its "Episodes" heading.
  const seasonsInHeader = $derived(seasonStyle === 'dropdown' && plan.composed && plan.variant === 'header' && aired > 0 && seasonList.length > 1)
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

{#snippet seasonLead()}<SeasonPicker entries={seasonList} variant="dropdown" inline />{/snippet}

{#if total > 0}
<div data-slot="detail.episodes" class="relative">
  {#if plan.gutter && aired > 0}
    <button type="button" data-focusable class="episode-order-flip" data-part="episodes.sort" data-variant="flip" data-dir={sortDir} onclick={flipSort}
            title={sortDir === 'asc' ? 'Show newest first' : 'Show oldest first'}
            aria-label={sortDir === 'asc' ? 'Show newest first' : 'Show oldest first'}>
      {#if sortDir === 'asc'}<ArrowDown01 size={20} />{:else}<ArrowUp10 size={20} />{/if}
    </button>
    {#if !selecting && !offline && !plan.composed}
      <button type="button" data-focusable class="episode-order-flip episode-download-flip" data-part="episodes.download" onclick={startSelect}
              title="Download episodes" aria-label="Download episodes">
        <Download size={18} />
      </button>
    {/if}
  {/if}
  <div class={episodeTheme?.placement === 'right' ? 'min-[960px]:max-h-[calc(100vh-5rem)] min-[960px]:overflow-y-auto' : ''}>
  {#if playState.status === 'error'}
    <p class="mb-3 text-sm text-destructive">{playState.message}</p>
  {/if}
  {#if seasonList.length > 1 && !seasonsInHeader}
    <SeasonPicker entries={seasonList} variant={seasonVariant} />
  {/if}

  {#if aired > 0}
    {#if plan.composed}
      <EpisodeToolbar {plan} order={episodeTheme?.order === 'flip' ? 'flip' : 'tabs'} {total}
                      bind:sortDir bind:query={episodeQuery}
                      ranges={rangeMenu} page={curPage} onpage={(index) => (page = index)}
                      onlayout={setLayout} ondownload={startSelect} onqueue={queueNextEpisode}
                      queueLabel={queuedNotice ? m.lists_queued_episode({ episode: nextQueueEpisode }) : m.lists_add_queue()}
                      queueTitle={`${m.lists_add_queue()} — Episode ${nextQueueEpisode}`}
                      lead={seasonsInHeader ? seasonLead : undefined} />
      {#if !$isMobile && !selecting && !plan.gutter}
        <!-- Release timing stays with the desktop episode controls, as in izumi's own bar. -->
        <div class="-mt-2 mb-3 flex flex-wrap items-center gap-3"><AiringStatus {media} toolbar /></div>
      {/if}
    {:else if flipOrder && !$isMobile && !selecting}
      {#if $episodeQueueEnabled}
        <div class="mb-3 flex justify-end" data-slot="episodes.toolbar" data-variant="bar">
          <button data-focusable onclick={queueNextEpisode} data-part="episodes.queue" disabled={aired < 1}
                  title={`${m.lists_add_queue()} — Episode ${nextQueueEpisode}`}
                  class="flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent disabled:opacity-40">
            <ListPlus size={15} /> {queuedNotice ? m.lists_queued_episode({ episode: nextQueueEpisode }) : m.lists_add_queue()}
          </button>
        </div>
      {/if}
    {:else}
    <div class="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap" data-slot="episodes.toolbar" data-variant="bar">
      {#if !$isMobile}
      {#if !selecting && !flipOrder}
        <div class="flex rounded-lg bg-secondary p-0.5 text-sm font-bold" data-part="episodes.sort" data-variant="tabs" data-dir={sortDir}>
          <button data-focusable onclick={() => toggleSort('asc')} data-active={sortDir === 'asc' || undefined}
                  class="rounded-md px-3 py-1.5 transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
          <button data-focusable onclick={() => toggleSort('desc')} data-active={sortDir === 'desc' || undefined}
                  class="rounded-md px-3 py-1.5 transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
        </div>
      {/if}
      {#if showEpisodeSearch}
      <label class="relative col-span-2 min-w-0 sm:max-w-sm sm:flex-1" data-part="episodes.search">
        <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          data-part="input"
          bind:value={episodeQuery}
          data-focusable
          placeholder="Find episode number or title…"
          class="h-12 w-full rounded-xl bg-input pl-10 pr-3 text-base sm:h-auto sm:rounded-md sm:py-2 sm:pl-9 sm:text-sm"
        />
      </label>
      {/if}
      {/if}
      {#if $isMobile}
        <div class="flex min-h-11 w-full items-stretch rounded-xl bg-secondary p-1 text-sm font-bold" data-part="episodes.sort" data-variant="tabs" data-dir={sortDir}>
          <button data-focusable onclick={() => toggleSort('asc')} data-active={sortDir === 'asc' || undefined}
                  class="flex min-h-9 flex-1 items-center justify-center rounded-lg px-3 leading-none transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
          <button data-focusable onclick={() => toggleSort('desc')} data-active={sortDir === 'desc' || undefined}
                  class="flex min-h-9 flex-1 items-center justify-center rounded-lg px-3 leading-none transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
        </div>
      {:else}
        {#if $episodeQueueEnabled}<button data-focusable onclick={queueNextEpisode} data-part="episodes.queue" disabled={aired < 1}
                title={`${m.lists_add_queue()} — Episode ${nextQueueEpisode}`}
                class="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold hover:bg-accent disabled:opacity-40 sm:h-auto sm:rounded-md sm:py-2">
          <ListPlus size={15} /> {queuedNotice ? m.lists_queued_episode({ episode: nextQueueEpisode }) : m.lists_add_queue()}
        </button>{/if}
        {#if !selecting && !flipOrder}
          {#if !offline}
            <button data-focusable onclick={startSelect} data-part="episodes.download"
                    title="Download episodes"
                    class="flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
              <Download size={15} /> Download…
            </button>
          {/if}
        {/if}
      {/if}
      {#if $isMobile}
        {#if $episodeQueueEnabled}<button data-focusable onclick={queueNextEpisode} data-part="episodes.queue" disabled={aired < 1}
                class="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold disabled:opacity-40">
          <ListPlus size={16} /> {m.lists_add_queue()}
        </button>{/if}
        <!-- Layout switch: mobile-only. Rendering it unconditionally added two data-focusable
             stops to the desktop toolbar and the Deck's controller focus order for a layout that
             doesn't apply there. A theme's grid or carousel arrangement ignores the numbers layout,
             so the switch only shows where it does something. -->
        {#if layoutSwitch || showEpisodeSearch}
        <div role="group" aria-label="Episode layout" data-part={layoutSwitch ? 'episodes.layout' : undefined} data-layout={$episodeLayout}
             class="flex min-h-11 items-stretch rounded-xl bg-secondary p-1">
          {#if layoutSwitch}
          <button data-focusable onclick={() => setLayout('list')} aria-label="Episode cards"
                  aria-pressed={$episodeLayout !== 'grid'} data-active={$episodeLayout !== 'grid' || undefined}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {$episodeLayout !== 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <Rows3 size={17} />
          </button>
          <button data-focusable onclick={() => setLayout('grid')} aria-label="Episode numbers"
                  aria-pressed={$episodeLayout === 'grid'} data-active={$episodeLayout === 'grid' || undefined}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {$episodeLayout === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <LayoutGrid size={17} />
          </button>
          {/if}
          {#if showEpisodeSearch}
          <button data-focusable data-part="episodes.search" data-active={searchOpen || undefined} onclick={() => { h.tap(); searchOpen = !searchOpen; if (!searchOpen) episodeQuery = '' }}
                  aria-label="Search episodes" aria-pressed={searchOpen}
                  class="grid min-h-9 w-11 place-items-center rounded-lg transition-colors {searchOpen ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">
            <Search size={17} />
          </button>
          {/if}
        </div>
        {/if}
      {/if}
      {#if !$isMobile && !selecting && !flipOrder}
        <!-- Release timing belongs to episode controls, not series navigation. `ml-auto` keeps it
             at the opposite edge from the actions; if the toolbar wraps, it remains right-aligned. -->
        <div class="col-span-2 ml-auto flex shrink-0 items-center gap-3">
          <AiringStatus {media} toolbar />
        </div>
      {/if}
    </div>
    {/if}
    {#if $isMobile && searchOpen && showEpisodeSearch}
      <label class="relative mb-4 block min-w-0" data-part="episodes.search">
        <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input data-part="input" bind:value={episodeQuery} data-focusable placeholder="Find episode number or title…"
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
    {#if selecting || !plan.composed}
    <div class="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      {#if !selecting}
        <button data-focusable onclick={startSelect} data-part="episodes.download"
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
    {/if}
    {#if !selecting && subscription}
      <p class="mb-3 text-xs font-bold text-theme">Auto-download is watching for episode {subscription.nextEpisode}.</p>
    {/if}
  {/if}

  {#if continueCard && aired > 0 && !selecting}
    {@const target = ctaEpisode}
    {@const started = episodeBarPercent($positions[progressKey(media.id, target)], false, target <= aired)}
    {@const percent = episodeBarPercent($positions[progressKey(media.id, target)], watchedThrough >= target, target <= aired)}
    {@const shownTitle = $hideSpoilers && watchedThrough < target ? '' : meta[target]?.title ?? ''}
    {@const art = meta[target]?.image || media.bannerImage || cover(media)}
    <button type="button" data-part="episode.continue" data-filler={fillerSet.has(target) || undefined} data-focusable
            onclick={continueWatching} onpointerenter={() => intent(target)} onfocus={() => intent(target)}
            class="relative mb-4 block h-20 w-full overflow-hidden rounded-xl bg-secondary text-left">
      {#if art}<img src={art} alt="" loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover" />{/if}
      <span class="absolute inset-0 bg-black/60"></span>
      <span class="relative flex h-full items-center gap-3 px-4">
        <span class="min-w-0 flex-1">
          <span data-part="episode.continue.label" class="block truncate text-sm font-black text-white">{watchedThrough > 0 || started > 0 ? 'Continue' : 'Play'}: Episode {numberLabel(target)}</span>
          {#if shownTitle}<span data-part="episode.continue.title" class="block truncate text-xs font-bold text-white/80">{shownTitle}</span>{/if}
        </span>
        <Play size={20} class="shrink-0 text-white" />
      </span>
      {#if percent > 0}
        <span class="absolute inset-x-0 bottom-0 h-0.5 bg-white/20"><span class="block h-full bg-theme" style={`width:${percent}%`}></span></span>
      {/if}
    </button>
  {/if}

  {#if episodeTheme?.paging === 'ranges' && pages > 1 && !searchedEpisodes}
    <div data-part="episodes.ranges" bind:this={rangesRow}
         class="relative -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {#each rangeChips as range, index (index)}
        <button type="button" data-part="chip" data-active={index === curPage || undefined} data-focusable
                onclick={() => { h.select(); page = index }}
                class="shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-bold transition-colors {index === curPage ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}">{range}</button>
      {/each}
    </div>
  {/if}

  {#if metaLoading}
    <!-- Immediate skeleton grid (shape matches the setting) so the list appears at
         once and doesn't flip layouts; real cards then fade their thumbnails in. -->
    {#if $episodeLayout === 'cards'}
      <div class="grid select-none {episodeListLayout ? 'grid-cols-1 gap-4' : 'grid-cols-1 gap-3 min-[500px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'}">
        {#each eps as ep (ep)}
          <button data-focusable={ep === quickEpisode ? '' : undefined}
                  data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                  data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                  tabindex={ep === quickEpisode ? 0 : -1} disabled={ep !== quickEpisode}
                  onpointerenter={() => intent(ep)} onfocus={() => intent(ep)}
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
                  onpointerenter={() => intent(ep)} onfocus={() => intent(ep)}
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
                  onpointerenter={() => intent(ep)} onfocus={() => intent(ep)}
                  onclick={(event) => tap(ep, event)} aria-label={`Play episode ${numberLabel(ep)}`}
                  class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2 text-left disabled:opacity-100">
            <div class="skeloader size-8 shrink-0 rounded"></div>
            <div class="skeloader h-3.5 flex-1 rounded"></div>
          </button>
        {/each}
      </div>
    {/if}
  {:else if episodeCarousel}
    <div class="flex gap-5 overflow-x-auto pb-3">
      {#each rows as ep (`${sortDir}-${ep}`)}
        <div class="w-[min(100%,18rem)] shrink-0">
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
          onintent={intent}
          onqueue={$episodeQueueEnabled ? queueEpisode : undefined}
          themeCard={episodeCard}
          hoverScale={false}
          listRow={false}
          state={stateOf(ep)}
          cta={ep === ctaEpisode && ep <= aired}
        />
        </div>
      {/each}
    </div>
  {:else if episodeGridLayout || $episodeLayout === 'cards'}
    <div class="grid select-none {episodeListLayout ? 'grid-cols-1 gap-2 px-2' : episodeGridLayout ? 'grid-cols-1 gap-4 min-[500px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]' : 'grid-cols-1 gap-3 min-[500px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'}">
      {#each rows as ep (`${sortDir}-${ep}`)}
        <div class="{episodeListLayout && episodeHoverScale ? 'episode-scale' : ''} {episodeListLayout ? 'episode-load-in' : ''}">
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
          onintent={intent}
          onqueue={$episodeQueueEnabled ? queueEpisode : undefined}
          themeCard={episodeCard}
          hoverScale={episodeHoverScale && !episodeListLayout}
          listRow={episodeListLayout}
          state={stateOf(ep)}
          cta={ep === ctaEpisode && ep <= aired}
        />
        </div>
      {/each}
    </div>
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
        <button data-part="episode" data-variant="number" data-state={tile.kind} data-next={ep === ctaEpisode && ep <= aired || undefined} data-filler={fillerSet.has(ep) || undefined} data-focusable data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
                data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
                disabled={!tile.playable} onpointerenter={() => intent(ep)} onfocus={() => intent(ep)}
                onclick={(event) => { h.tap(); tap(ep, event) }}
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
          data-part="episode" data-variant="row" data-state={stateOf(ep)} data-next={ep === ctaEpisode && ep <= aired || undefined} data-filler={filler || undefined}
          data-focusable
          data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}
          data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}
          role="button"
          tabindex="0"
          aria-disabled={!released || resolving}
          aria-pressed={selecting ? sel : undefined}
          onclick={(event) => { if (!resolving) { h.tap(); tap(ep, event) } }}
          onpointerenter={() => intent(ep)} onfocus={() => intent(ep)}
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
            <span data-part="episode.number" class="grid h-7 min-w-7 shrink-0 place-items-center rounded px-1 text-sm font-black sm:h-8 sm:min-w-8 {done ? 'bg-theme/25 text-theme' : 'bg-background/40'}">{numberLabel(ep)}</span>
          {/if}
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span data-part="episode.title" class="truncate text-sm font-bold">{labels.primary}</span>
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
          {#if $episodeQueueEnabled && released && !selecting}
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

  {#if searchedEpisodes && !searchedEpisodes.length}
    <p data-part="episodes.empty" class="py-8 text-center text-sm text-muted-foreground">No episode matches “{episodeQuery.trim()}”.</p>
  {/if}

  {#if pages > 1 && !searchedEpisodes && pagerShown}
    <div data-part="episodes.pager" class="mt-4 flex items-center gap-3 text-sm">
      <button data-part="page-number" data-focusable disabled={curPage === 0} onclick={() => (page = curPage - 1)}
              class="rounded bg-secondary px-4 py-2.5 disabled:opacity-40 sm:py-1">Prev</button>
      <span class="text-muted-foreground">Episodes {startIdx + 1}–{startIdx + eps.length} of {total} · page {curPage + 1}/{pages}</span>
      <button data-part="page-number" data-focusable disabled={curPage >= pages - 1} onclick={() => (page = curPage + 1)}
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
  </div>
</div>
{:else if next?.episode}
  <p class="text-sm text-muted-foreground">Episode 1 airing in {countdown(next.timeUntilAiring)}</p>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}

<style>
  .episode-scale {
    padding: 0.4rem 0.75rem;
    transform-origin: center;
    transition: transform 0.2s ease-in-out;
  }
  .episode-scale:hover,
  .episode-scale:focus-within {
    position: relative;
    z-index: 10;
    transform: scale(1.035);
  }
  .episode-order-flip {
    position: absolute;
    left: -2.75rem;
    top: 0.35rem;
    z-index: 20;
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border-radius: 999px;
    background: hsl(var(--secondary));
    color: hsl(var(--foreground));
  }
  .episode-order-flip:hover { background: hsl(var(--accent)); }
  .episode-download-flip { top: 3.35rem; }
  .episode-load-in {
    animation: episode-load-in 0.4s ease 1;
  }
  @keyframes episode-load-in {
    0% { transform: translateY(1.5rem) scale(0.98); }
    60% { transform: translateY(-0.25rem) scale(1.015); }
    100% { transform: none; }
  }
</style>
