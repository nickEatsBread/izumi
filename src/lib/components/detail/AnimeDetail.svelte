<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { invoke } from '@tauri-apps/api/core'
  import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import EpisodeList from '$lib/components/detail/EpisodeList.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { banner, title, cover, format, status, season, seasonBrowseHref, ratingBg, resumeEp, totalEpisodes } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { resumeEpisode, playEpisode, type PlayState } from '$lib/stremio/play'
  import { offlineMode } from '$lib/stores/offline'
  import { downloads, downloadedMedia } from '$lib/downloads/state'
  import { localHistory, sessionProgress, manualProgressOverrides } from '$lib/player/history'
  import { seriesTitle } from '$lib/downloads/library'
  import { readable } from 'svelte/store'
  import { focusOnMount } from '$lib/nav'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import { getMalProgress } from '$lib/trackers'
  import type { AniStatus } from '$lib/trackers'
  import { malToAni, mergedProgress, STATUS_LABEL, STATUS_COLOR } from '$lib/trackers/status'
  import ListEditor from '$lib/components/detail/ListEditor.svelte'
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Share2 from '@lucide/svelte/icons/share-2'
  import Clapperboard from '@lucide/svelte/icons/clapperboard'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Play from '@lucide/svelte/icons/play'
  import Check from '@lucide/svelte/icons/check'
  import MoreHorizontal from '@lucide/svelte/icons/ellipsis'
  import { isAndroid, isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import RichMetadata from './RichMetadata.svelte'
  import AiringStatus from './AiringStatus.svelte'
  import MediaTagList from './MediaTagList.svelte'
  import { reliableImage } from '$lib/util/reliable-image'
  import { detailHints, rememberDetail } from '$lib/anilist/detail-hint'
  import { heroBarState } from './hero-bar'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import { goto } from '$app/navigation'
  import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'
  import { openTrailerPopup } from '$lib/stores/trailer'
  import { gameMode } from '$lib/player/session'

  // `id` is a prop (the +page keys this component on it), so navigating anime→relation
  // remounts with the new id and the query re-fetches — a same-route param change alone
  // would NOT re-run a component captured at mount.
  let { id }: { id: number } = $props()

  const client = getContextClient()
  // Offline: never touch AniList — feed a static empty store and build media from the local
  // snapshot instead. Recreating the real queryStore on reconnect refetches automatically.
  const EMPTY_STORE = readable(
    { fetching: false, error: undefined, data: undefined } as {
      fetching: boolean; error?: { message: string }; data?: { Media: Media }
    },
  )
  const store = $derived(
    $offlineMode ? EMPTY_STORE : queryStore<{ Media: Media }>({ client, query: MEDIA_BY_ID, variables: { id } }),
  )

  // MAL read-back: pull the viewer's watched-episode count from MAL and merge it
  // into the AniList media, so progress shows even when the user tracks on MAL
  // (AniList's mediaListEntry is null/0 then). Take whichever tracker is further
  // along. `media` is what the whole page renders — badge, resume, episode marks.
  let malEntry = $state<{ progress: number; status: string; score: number } | null>(null)
  // NOT $state, and it must stay that way. This is a bookkeeping latch, not UI state: the effect
  // both READS it (the guard) and WRITES it, so as $state the write re-triggered the effect, and
  // Svelte runs an effect's teardown before re-running it — the teardown cancelled the MAL request
  // the same pass had just started, so `malEntry` never landed. Symptom: MAL read-back was dead on
  // every detail page (no status pill, no MAL progress), which reads as "Add to List" on a title
  // that is already on the user's list.
  let malEntryFor: number | null = null
  $effect(() => {
    // Guard on `idMal` so an unrelated store emission doesn't refetch: without it a MAL-only user
    // watched the header badge fall back to "0/12" and the CTA revert from "Continue · Ep 8" to
    // "Play" for one MAL round-trip on every emission.
    const idMal = $store.data?.Media?.idMal
    if (idMal === malEntryFor) return
    malEntryFor = idMal ?? null
    malEntry = null
    if (!idMal) return
    // Accept the response only if it is still the title we asked about. Snapshotting the key beats
    // an effect-scoped `cancelled` flag here, because ANY re-run of this effect (urql emits several
    // times per query) would fire that flag's teardown and drop an in-flight request.
    getMalProgress(idMal).then((e) => { if (malEntryFor === idMal) malEntry = e })
  })
  // Offline: build the page's media from the local snapshot (downloadedMedia → localHistory →
  // synthesized from the DownloadItems) with progress folded from local history, so the header
  // badge, the CTA label, and the episode marks all agree. `null` = a title with no downloads.
  const offlineMedia = $derived.by((): Media | null | undefined => {
    if (!$offlineMode) return undefined
    const doneItems = Object.values($downloads).filter((d) => d.mediaId === id && d.status === 'done')
    const snap = $downloadedMedia[id] ?? $localHistory[id]?.media
    if (!snap && !doneItems.length) return null
    const base: Media = snap ?? ({
      id, title: { userPreferred: seriesTitle(doneItems[0]?.title ?? '') },
      coverImage: { extraLarge: doneItems[0]?.poster },
    } as Media)
    const progress = Math.max($localHistory[id]?.progress ?? 0, base.mediaListEntry?.progress ?? 0)
    return { ...base, mediaListEntry: { ...(base.mediaListEntry ?? {}), progress } } as Media
  })

  const media = $derived.by(() => {
    if ($offlineMode) return offlineMedia
    const base = $store.data?.Media
    if (!base) return base
    const malP = malEntry?.progress ?? 0
    if (malP <= (base.mediaListEntry?.progress ?? 0)) return base
    return { ...base, mediaListEntry: { ...base.mediaListEntry, progress: malP, status: base.mediaListEntry?.status ?? malEntry?.status } }
  })
  const detailHint = $derived($detailHints[id])
  $effect(() => { if (media) rememberDetail(media) })
  // Reset the fade latch when the media changes, so navigating between series does not show the
  // previous title's fade-in state (or a stale full-opacity frame) before the new art decodes.
  $effect(() => { void media?.id; artLoaded = false })

  // Match the episode list's progress ownership. Tracker queries can still be stale when Android
  // returns from the player, while session/local history has already recorded the completed episode.
  const watchedThrough = $derived(
    $manualProgressOverrides[id] ?? Math.max(
      media?.mediaListEntry?.progress ?? 0,
      $localHistory[id]?.progress ?? 0,
      $sessionProgress[id] ?? 0,
    ),
  )

  // Resume target for the hero CTA. Offline = first not-yet-watched DOWNLOADED episode (else the
  // first downloaded) — never resumeEp(), which reads tracker progress and could point at an
  // episode that isn't on disk. `playCta` also routes offline through playEpisode (the local swap)
  // instead of resumeEpisode (which would fire a live fetchMediaById + online resolve).
  function offlineResumeEp(m: Media): number {
    const doneEps = Object.values($downloads)
      .filter((d) => d.mediaId === m.id && d.status === 'done').map((d) => d.episode).sort((a, b) => a - b)
    if (!doneEps.length) return 1
    const prog = $localHistory[m.id]?.progress ?? 0
    return doneEps.find((e) => e > prog) ?? doneEps[0]
  }
  const ctaEp = (m: Media) => ($offlineMode ? offlineResumeEp(m) : resumeEp(m, watchedThrough))
  const ctaHasProgress = (m: Media) => ($offlineMode ? (m.mediaListEntry?.progress ?? 0) : watchedThrough) > 0
  function playCta(m: Media) {
    h.impact('medium')
    if ($offlineMode) playEpisode(m, offlineResumeEp(m), (s) => (heroPlay = s))
    else resumeEpisode(m, ctaEp(m), (s) => (heroPlay = s))
  }

  let active = $state('Episodes')
  let heroPlay = $state<PlayState>({ status: 'idle' })

  // Action-bar transient/optimistic state.
  let copied = $state(false)
  let showMore = $state(false)      // mobile action overflow menu
  let descExpanded = $state(false)  // mobile description clamp toggle
  // List-editor state. `listOpt` is the optimistic patch applied after a save so the status pill +
  // progress badge reflect instantly (the tracker queue reconciles AniList/MAL in the background).
  let showEditor = $state(false)
  let listOpt = $state<{ status?: AniStatus; progress?: number; score?: number; removed?: boolean }>({})
  const rawEntry = $derived($store.data?.Media?.mediaListEntry) // AniList list entry (has id/status/score)
  const effStatus = $derived.by((): AniStatus | undefined => {
    if (listOpt.removed) return undefined
    if (listOpt.status) return listOpt.status
    return (rawEntry?.status as AniStatus | undefined) ?? malToAni(malEntry?.status)
  })
  // Explicit user actions (optimistic edit, manual override) win outright; between the trackers
  // take the max — an AniList entry at 0 must not `??`-shadow real MAL progress.
  const effProgress = $derived(listOpt.removed ? 0 : (
    listOpt.progress
    ?? $manualProgressOverrides[id]
    ?? mergedProgress(rawEntry?.progress, malEntry?.progress)
  ))
  const effScore100 = $derived(listOpt.removed ? 0 : (listOpt.score ?? rawEntry?.score ?? (malEntry?.score ?? 0) * 10))
  const hasEntry = $derived(!!effStatus)

  const fmtDate = (d?: { year?: number; month?: number; day?: number } | null) =>
    d?.year ? [d.year, d.month, d.day].filter(Boolean).join('-') : ''

  const stripHtml = (s?: string) => (s ? s.replace(/<[^>]+>/g, '') : '')
  const prettyEnum = (value?: string) => value
    ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
    : ''
  const countryName = (code?: string) => ({ JP: 'Japan', CN: 'China', KR: 'South Korea', TW: 'Taiwan' }[code ?? ''] ?? code ?? '')
  const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  // Total episodes for the badge — schedule-aware so OVAs/ONAs with a null AniList count
  // still show a number (see totalEpisodes).
  const epsTotal = totalEpisodes
  async function onShare(m: Media) {
    const url = `https://anilist.co/anime/${m.id}`
    if ($isAndroid) {
      await invoke('plugin:extplayer|share_text', {
        payload: { title: `Share ${title(m)}`, text: `${title(m)}\n${url}` },
      }).catch((error) => console.warn('[share] Android share sheet failed:', error))
      return
    }
    // navigator.clipboard is absent in the WebKitGTK webview — use the webview-safe helper.
    if (copyToClipboard(url)) {
      copied = true
      setTimeout(() => (copied = false), 1500)
    }
  }

  // --- Mobile hero -------------------------------------------------------------------------
  // The page paints under the status bar while this component is mounted; the class is removed on
  // teardown so every other screen keeps the normal inset even if the user navigates mid-transition.
  let artHeight = $state(0)
  let barHeight = $state(0)
  // The banner is a large image over a network the phone may be struggling with; popping it in at
  // full opacity reads as a glitch. Fade on decode instead.
  let artLoaded = $state(false)
  // `wasSolid` is deliberately a plain `let`, NOT $state: the scroll handler both reads and writes
  // it to resolve the hysteresis, and a reactive latch read+written by its own effect is a cycle
  // Svelte resolves as an update loop, not a settled value (same trap as malEntryFor above).
  let wasSolid = false
  let barState = $state({ solid: false, showTitle: false })
  function onHeroScroll() {
    const next = heroBarState(window.scrollY, artHeight, barHeight, wasSolid)
    // Nothing to publish while the state is unchanged — which is every scroll frame but two. This
    // also keeps the bar off the reactive graph during a fling.
    if (next.solid === wasSolid) return
    wasSolid = next.solid
    barState = next
  }
  // Acquired for every branch on mobile, not just once the hero has loaded — gating this on `media`
  // made the page jump by the status-bar height the instant the skeleton was replaced by the loaded
  // hero. The loading/error/not-found branches carry their own top padding instead of the bar.
  // Shared with the settings layout via a refcount: their lifetimes can overlap mid-navigation.
  $effect(() => {
    if (!$isMobile) return
    return acquireEdgeToEdge()
  })
  // artHeight/barHeight land a frame after mount; recompute once they do so the bar is in the right
  // state for the scroll position the page was restored to.
  $effect(() => { void artHeight; void barHeight; onHeroScroll() })
  // Back returns to where the user came from, preserving that screen's scroll position. A deep
  // link (share sheet, notification) has no history to return to, so it lands on Home instead of
  // leaving the chevron dead.
  function heroBack() {
    h.tap()
    if (typeof history !== 'undefined' && history.length > 1) history.back()
    else void goto('/app/home')
  }
</script>

<svelte:window onscroll={$isMobile ? onHeroScroll : undefined} onkeydown={(e) => { if (e.key === 'Escape' && showMore) showMore = false }} />

{#if !$offlineMode && $store.fetching && !media}
  {#if $isMobile}
    <!-- Shapes the loading skeleton after the real hero below: a full-bleed artwork band (same
         height classes, so the two cannot drift apart), then poster + stacked title/meta beside
         it, a synopsis block, and a full-width button bar — so the page does not visibly
         re-lay-out the instant data lands. -->
    <div class="relative pb-8 pt-[max(2.5rem,env(safe-area-inset-top))]">
      {#if detailHint && banner(detailHint)}
        <img src={banner(detailHint)} alt="" class="h-[26vh] max-h-72 min-h-44 w-full object-cover opacity-35" />
      {:else}
        <div class="h-[26vh] max-h-72 min-h-44 w-full skeloader"></div>
      {/if}
      <div class="px-4">
        <div class="relative z-10 -mt-10 flex gap-4">
          {#if detailHint && cover(detailHint)}<img src={cover(detailHint)} alt="" class="h-auto w-28 shrink-0 self-start rounded-xl object-contain shadow-xl min-[420px]:w-32" />{:else}<div class="aspect-[46/65] w-28 shrink-0 self-start rounded-xl skeloader min-[420px]:w-32"></div>{/if}
          <div class="min-w-0 flex-1 self-end space-y-2 pb-1">
            <div class="min-h-3 text-xs text-muted-foreground">{detailHint?.title.native || detailHint?.title.romaji || ''}</div>
            {#if detailHint}
              <h1 class="line-clamp-2 text-xl font-black leading-tight">{title(detailHint)}</h1>
            {:else}
              <div class="h-12 w-4/5 rounded skeloader"></div>
            {/if}
          </div>
        </div>
        <div class="mt-3 flex gap-2"><span class="h-5 w-16 rounded-full skeloader"></span><span class="h-5 w-24 rounded-full skeloader"></span></div>
        <div class="mt-4 space-y-1.5">
          <div class="h-4 w-full rounded skeloader"></div>
          <div class="h-4 w-full rounded skeloader"></div>
          <div class="h-4 w-2/3 rounded skeloader"></div>
        </div>
        <div class="mt-4 h-12 w-full rounded-lg skeloader"></div>
        <div class="mt-2 grid grid-cols-4 gap-2">{#each Array(4) as _}<div class="h-11 rounded-lg skeloader"></div>{/each}</div>
      </div>
    </div>
  {:else}
    <!-- Match the loaded desktop Hero + overlapping info panel exactly. The previous pt-24
         skeleton started the poster near the window top, then the real page moved it beneath a
         55vh banner — a large avoidable layout jump on every series navigation. -->
    <div class="relative mb-6 h-[40vh] {$gameMode ? 'sm:h-[42vh]' : 'sm:h-[48vh]'}">
      <div class="absolute left-0 top-0 h-[calc(100%+2rem)] w-screen overflow-hidden sm:-left-14 sm:-top-8">
        {#if detailHint && banner(detailHint)}
          <img src={banner(detailHint)} alt="" class="absolute inset-0 h-full w-full object-cover opacity-30" style="object-position:center 20%" />
        {:else}
          <div class="absolute inset-0 skeloader opacity-60"></div>
        {/if}
        <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
        <div class="absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-background/85 via-background/40 to-transparent"></div>
      </div>
    </div>
    <div class="relative {$gameMode ? '-mt-[16vh]' : '-mt-[18vh]'} px-4 pb-16 sm:px-8">
      <div class="mb-6 flex flex-col gap-6 md:flex-row">
        <!-- Same intrinsic cover sizing as the loaded panel; using the real hint image avoids a
             ratio correction when AniList's artwork is not exactly the fallback 46/65 shape. -->
        {#if detailHint && cover(detailHint)}<img src={cover(detailHint)} alt="" class="h-auto w-44 shrink-0 self-start rounded-lg object-contain shadow-lg" />{:else}<div class="aspect-[46/65] w-44 shrink-0 self-start rounded-lg skeloader"></div>{/if}
        <div class="min-w-0 max-w-3xl flex-1">
          <div class="min-h-5 text-sm text-muted-foreground">{detailHint?.title.native || detailHint?.title.romaji || ''}</div>
          {#if detailHint}
            <h1 class="mb-3 text-3xl font-black">{title(detailHint)}</h1>
          {:else}
            <div class="mb-3 h-9 w-3/5 rounded skeloader"></div>
          {/if}
          <div class="mb-4 flex h-6 gap-2">
            <span class="w-24 rounded-full skeloader"></span><span class="w-16 rounded-full skeloader"></span><span class="w-20 rounded-full skeloader"></span>
          </div>
          <div class="mb-4 space-y-1.5">
            <div class="h-4 w-full rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-4 w-4/5 rounded skeloader"></div><div class="h-4 w-1/2 rounded skeloader"></div>
          </div>
          <div class="mb-4 flex h-6 gap-2"><span class="w-16 rounded-full skeloader"></span><span class="w-20 rounded-full skeloader"></span><span class="w-14 rounded-full skeloader"></span></div>
          <div class="flex h-10 gap-2"><span class="w-24 rounded-md skeloader"></span><span class="w-28 rounded-md skeloader"></span><span class="w-10 rounded-md skeloader"></span></div>
        </div>
      </div>
    </div>
  {/if}
{:else if !$offlineMode && $store.error}
  <div class="p-8 pt-[max(2rem,env(safe-area-inset-top))] text-muted-foreground">Failed to load: {$store.error.message}</div>
{:else if media}
  {@const m = media}
  {@const trackerConnected = !!($anilistToken || $malToken)}
  {#if $isMobile}
    <div class="relative pb-8">
      <!-- Floating bar. Transparent over the artwork (with a scrim so the chevron survives light
           art), blurred and titled once the artwork has scrolled under it. It carries the status-bar
           inset itself: a fixed element does not inherit main's padding once it locks. -->
      <div bind:clientHeight={barHeight}
           class="fixed inset-x-0 top-0 z-30 flex items-center gap-2 px-2 py-2 transition-colors duration-200
                  {barState.solid ? 'border-b border-border bg-background/80 backdrop-blur' : 'text-white'}"
           style="padding-top:max(0.5rem,env(safe-area-inset-top))">
        {#if !barState.solid}
          <div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/55 to-transparent"></div>
        {/if}
        <button data-focusable onclick={heroBack} aria-label="Back"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/15">
          <ChevronLeft size={22} />
        </button>
        {#if barState.showTitle}
          <span class="min-w-0 flex-1 truncate text-base font-black">{title(m)}</span>
        {/if}
      </div>

      <!-- Artwork band: a bounded strip that ends in a hard cut. Nothing is written on top of it,
           so legibility no longer depends on how busy the banner is. -->
      <div bind:clientHeight={artHeight} class="hero-art relative h-[26vh] max-h-72 min-h-44 w-full overflow-hidden">
        {#if m.bannerImage}
          <img src={m.bannerImage} alt="" onload={() => (artLoaded = true)}
               class="h-full w-full object-cover transition-opacity duration-500 {artLoaded ? 'opacity-100' : 'opacity-0'}"
               style="object-position:center 20%" />
        {:else}
          <!-- No banner: a YouTube trailer still has blurred pillarbox bars baked into the JPEG, and a
               portrait cover cropped to a wide band loses its subject. Blur the cover into a wash
               instead — it reads as ambient colour rather than a broken photograph. -->
          <img src={cover(m)} alt="" class="h-full w-full scale-110 object-cover blur-xl transition-opacity duration-500 {artLoaded ? 'opacity-50' : 'opacity-0'}"
               onload={() => (artLoaded = true)} style="object-position:center 30%" />
        {/if}
        <div class="absolute inset-x-0 bottom-0 h-1/6 bg-gradient-to-b from-transparent to-background"></div>
      </div>

      <div class="px-4">
        <!-- `relative z-10`: the artwork band above is positioned, so it paints OVER static
             in-flow content — and this row is pulled up into it. Without a stacking context of its
             own the band covered the top of the poster the moment its image loaded, which read as
             the cover being cropped (and looked fine until then, because the band was transparent). -->
        <div class="relative z-10 -mt-10 flex gap-4">
          <!-- Covers vary in aspect; forcing them all into one ratio with object-cover crops real
               artwork the user came here to see. Follow the image's own height instead. -->
          <img use:reliableImage={cover(m)} alt=""
               class="h-auto w-28 shrink-0 self-start rounded-xl object-contain shadow-xl min-[420px]:w-32" />
          <div class="min-w-0 flex-1 self-end">
            {#if m.title.native || m.title.romaji}
              <div class="truncate text-xs text-muted-foreground">{m.title.native || m.title.romaji}</div>
            {/if}
            <h1 class="line-clamp-2 text-xl font-black leading-tight">{title(m)}</h1>
          </div>
        </div>

        <!-- One line of facts instead of seven chips: on a phone the chips wrapped into three
             rows and read as a wall of pills rather than a summary. Facts sit directly under the
             title — identity first, schedule after. -->
        <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted-foreground">
          {#if m.averageScore}
            <span class="rounded-full px-1.5 py-0.5 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>
          {/if}
          {#if format(m)}<span>{format(m)}</span><span class="opacity-40">·</span>{/if}
          <span>{effProgress}/{epsTotal(m) || '?'} eps</span>
          {#if m.duration}<span class="opacity-40">·</span><span>{m.duration} min</span>{/if}
          {#if season(m)}<span class="opacity-40">·</span><a href={seasonBrowseHref(m)} class="underline-offset-2 active:opacity-70">{season(m)}</a>{/if}
          {#if status(m)}<span class="opacity-40">·</span><span>{status(m)}</span>{/if}
        </div>

        <!-- Give the title useful provenance without turning the summary into another pill wall.
             Mature mobile anime clients surface studio/source/popularity before asking the user to
             hunt through a final tab; this stays a single quiet wrapping line. -->
        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/65">
          {#if m.studios?.nodes?.[0]}
            {@const studio = m.studios.nodes[0]}
            <a href={studio.id ? `/app/search?studio=${studio.id}&name=${encodeURIComponent(studio.name)}` : `/app/search?search=${encodeURIComponent(studio.name)}`}
               class="font-bold text-foreground/85 underline-offset-2 active:opacity-70">{studio.name}</a>
          {/if}
          {#if m.source}<span class="opacity-35">·</span><span>From {prettyEnum(m.source)}</span>{/if}
          {#if m.popularity}<span class="opacity-35">·</span><span>{compactNumber.format(m.popularity)} members</span>{/if}
        </div>

        {#if m.genres?.length}
          <!-- One horizontal rail preserves vertical space while making genre identity visible at a
               glance. It deliberately scrolls instead of wrapping into a tall block above Play. -->
          <div class="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Genres">
            {#each m.genres as genre (genre)}
              <a href={`/app/search?genre=${encodeURIComponent(genre)}`}
                 class="shrink-0 rounded-full border border-border/80 bg-secondary/55 px-3 py-1.5 text-xs font-bold text-foreground/85 active:bg-accent">{genre}</a>
            {/each}
          </div>
        {/if}

        <!-- Phones have no room for release timing in their episode controls. Keep one quiet
             grouped summary under the facts; desktop anchors it to the episode toolbar instead. -->
        <div class="mt-3 flex flex-wrap items-center gap-2 empty:mt-0">
          <AiringStatus media={m} />
        </div>

        {#if m.description}
          <button type="button" onclick={() => (descExpanded = !descExpanded)}
                  class="mt-3 w-full text-left text-sm text-muted-foreground {descExpanded ? 'block' : 'line-clamp-3'}">
            {stripHtml(m.description)}
          </button>
        {/if}

        <!-- Primary CTA -->
        <button data-focusable use:focusOnMount
                onclick={() => playCta(m)}
                class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-bold text-primary-foreground">
          <Play size={18} />{ctaHasProgress(m) ? `Continue · Ep ${ctaEp(m)}` : $offlineMode ? `Play · Ep ${ctaEp(m)}` : 'Play'}
        </button>

        <!-- Compact action row: 4 icons + overflow. Handlers are the SAME functions the desktop bar uses. -->
        <div class="relative mt-2 flex items-center gap-2">
          {#if trackerConnected}
            <button data-focusable onclick={() => { h.tap(); showEditor = true }} aria-label="Edit list status"
                    class="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-secondary px-2 text-sm font-bold">
              {#if effStatus}
                <span class="size-2.5 shrink-0 rounded-full" style="background:{STATUS_COLOR[effStatus]}"></span>{STATUS_LABEL[effStatus]}
              {:else}
                <BookmarkPlus size={16} /> Add
              {/if}
            </button>
          {/if}
          <button data-focusable onclick={() => { h.tap(); void onShare(m) }} aria-label="Share series"
                  class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
            {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
          </button>
          {#if m.trailer?.id}
            <button data-focusable onclick={() => { h.tap(); openTrailerPopup(m.trailer!.id!, title(m)) }} aria-label="Trailer"
                    class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
              <Clapperboard size={18} />
            </button>
          {/if}
          <button data-focusable onclick={() => { h.tap(); showMore = !showMore }} aria-label="More"
                  aria-haspopup="true" aria-expanded={showMore}
                  class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
            <MoreHorizontal size={18} />
          </button>

          {#if showMore}
            <!-- Full-screen backdrop (below the menu) so a tap anywhere else dismisses it, matching
                 the trailer dialog's dismissal convention. Escape is handled on <svelte:window>. -->
            <button type="button" aria-label="Close menu" onclick={() => (showMore = false)}
                    class="fixed inset-0 z-40 cursor-default"></button>
            <div class="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-lg border border-border bg-card p-2 shadow-2xl">
              <button data-focusable onclick={() => { h.tap(); showMore = false; openUrl(`https://anilist.co/anime/${m.id}`) }}
                      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
                <ExternalLink size={15} /> Open on AniList
              </button>
              {#if m.idMal}
                <button data-focusable onclick={() => { h.tap(); showMore = false; openUrl(`https://myanimelist.net/anime/${m.idMal}`) }}
                        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
                  <ExternalLink size={15} /> Open on MyAnimeList
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if heroPlay.status === 'error'}
          <p class="mt-3 text-sm text-destructive">{heroPlay.message}</p>
        {/if}

        <div class="mt-6">
          <Tabs tabs={['Episodes', 'Overview', 'Relations', 'Characters', 'Recommended']} bind:active />
          {#if active === 'Episodes'}
            <EpisodeList media={m} offline={$offlineMode} />
          {:else if active === 'Overview'}
            <div class="mt-4 space-y-5">
              {#if m.description}
                <section>
                  <h2 class="mb-2 text-base font-black">Synopsis</h2>
                  <p class="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{stripHtml(m.description)}</p>
                </section>
              {/if}

              <section>
                <h2 class="mb-2 text-base font-black">Information</h2>
                <dl class="grid grid-cols-2 gap-2 text-sm">
                  {#if m.studios?.nodes?.length}
                    <div class="col-span-2 rounded-xl bg-secondary/40 p-3">
                      <dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Studio</dt>
                      <dd class="mt-1 font-bold">{#each m.studios.nodes as studio, i (studio.id ?? studio.name)}{i ? ' · ' : ''}<a class="underline-offset-2 active:opacity-70" href={studio.id ? `/app/search?studio=${studio.id}&name=${encodeURIComponent(studio.name)}` : `/app/search?search=${encodeURIComponent(studio.name)}`}>{studio.name}</a>{/each}</dd>
                    </div>
                  {/if}
                  {#if format(m)}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Format</dt><dd class="mt-1 font-bold">{format(m)}</dd></div>{/if}
                  {#if status(m)}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</dt><dd class="mt-1 font-bold">{status(m)}</dd></div>{/if}
                  <div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Episodes</dt><dd class="mt-1 font-bold">{epsTotal(m) || 'Unknown'}</dd></div>
                  {#if m.duration}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Runtime</dt><dd class="mt-1 font-bold">{m.duration} minutes</dd></div>{/if}
                  {#if season(m)}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Season</dt><dd class="mt-1 font-bold"><a href={seasonBrowseHref(m)} class="underline-offset-2 active:opacity-70">{season(m)}</a></dd></div>{/if}
                  {#if fmtDate(m.startDate)}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Premiered</dt><dd class="mt-1 font-bold">{fmtDate(m.startDate)}</dd></div>{/if}
                  {#if m.source}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Source</dt><dd class="mt-1 font-bold">{prettyEnum(m.source)}</dd></div>{/if}
                  {#if m.countryOfOrigin}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Country</dt><dd class="mt-1 font-bold">{countryName(m.countryOfOrigin)}</dd></div>{/if}
                  {#if m.averageScore}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Score</dt><dd class="mt-1 font-bold">{m.averageScore}%</dd></div>{/if}
                  {#if m.popularity}<div class="rounded-xl bg-secondary/40 p-3"><dt class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Popularity</dt><dd class="mt-1 font-bold">{m.popularity.toLocaleString()} members</dd></div>{/if}
                </dl>
              </section>

              {#if m.tags?.length}
                <section>
                  <h2 class="mb-2 text-base font-black">Themes</h2>
                  <MediaTagList tags={m.tags} limit={10} sortByRank />
                </section>
              {/if}

              {#if m.synonyms?.length}
                <section><h2 class="mb-1 text-base font-black">Alternative titles</h2><p class="text-sm leading-relaxed text-muted-foreground">{m.synonyms.join(' · ')}</p></section>
              {/if}
            </div>
          {:else if active === 'Relations'}
            {#if m.relations?.edges?.length}
              <div class="mt-3 grid grid-cols-2 gap-4">
                {#each m.relations.edges as e (e.node.id)}
                  <div class="min-w-0"><SmallCard media={e.node} fill /></div>
                {/each}
              </div>
            {:else}<p class="mt-3 text-muted-foreground">No related titles.</p>{/if}
          {:else if active === 'Characters'}
            <div class="mt-3"><RichMetadata media={m} view="people" /></div>
          {:else if active === 'Recommended'}
            <div class="mt-3"><RichMetadata media={m} view="recommendations" /></div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
  <!-- Title-less banner backdrop; the info panel below overlaps its lower fade. -->
  <Hero medias={[m]} showOverlay={false} />
  <div class="relative {$gameMode ? '-mt-[16vh]' : '-mt-[18vh]'} px-4 pb-16 sm:px-8">
    {#if heroPlay.status === 'error'}
      <p class="mb-3 text-sm text-destructive">{heroPlay.message}</p>
    {/if}

    <!-- Hero info panel: cover + title/badges/description + action bar. -->
    <!-- The banner is the dominant artwork; the portrait is an identity anchor, not the ruler for
         the whole header. At 13rem it left a poster-height void beneath the much shorter info
         column, delaying Episodes by roughly a full D-pad viewport. An 11rem cover retains a clear
         visual identity while keeping both columns close enough in height for Episodes to follow. -->
    <div class="mb-4 flex flex-col gap-5 md:flex-row">
      <img use:reliableImage={cover(m)} alt="" class="h-auto w-44 shrink-0 self-start rounded-lg object-contain shadow-lg" />

      <div class="min-w-0 flex-1">
        {#if m.title.native || m.title.romaji}
          <div class="text-sm text-muted-foreground">{m.title.native || m.title.romaji}</div>
        {/if}
        <h1 class="mb-2 text-3xl font-black">{title(m)}</h1>

        <!-- One scannable facts line replaces two rows of competing pills. Genres remain useful
             discovery links for pointer users, but are deliberately not D-pad stops in Game mode:
             Down from the primary action is a content path, not a tour through metadata. -->
        <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted-foreground">
          <span class="text-foreground">{effProgress}/{epsTotal(m) || '?'} episodes</span>
          {#if format(m)}<span class="opacity-40">·</span><span>{format(m)}</span>{/if}
          {#if status(m)}<span class="opacity-40">·</span><span>{status(m)}</span>{/if}
          {#if season(m)}
            <span class="opacity-40">·</span>
            <a data-focusable={$gameMode ? undefined : ''} tabindex={$gameMode ? -1 : undefined}
               href={seasonBrowseHref(m)} class="transition-colors hover:text-foreground hover:underline">{season(m)}</a>
          {/if}
          {#if m.averageScore}<span class="opacity-40">·</span><span class="rounded px-1.5 py-0.5 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>{/if}
          {#each (m.genres ?? []).slice(0, $gameMode ? 3 : 4) as g (g)}
            <span class="opacity-40">·</span>
            <a data-focusable={$gameMode ? undefined : ''} tabindex={$gameMode ? -1 : undefined}
               href={`/app/search?genre=${encodeURIComponent(g)}`}
               class="transition-colors hover:text-foreground hover:underline">{g}</a>
          {/each}
          {#if (m.genres?.length ?? 0) > ($gameMode ? 3 : 4)}
            <span class="font-medium opacity-60">+{(m.genres?.length ?? 0) - ($gameMode ? 3 : 4)}</span>
          {/if}
        </div>

        {#if m.description}
          <p class="mb-3 {$gameMode ? 'line-clamp-2' : 'line-clamp-3'} max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}

        <!-- Action bar -->
        <div class="flex flex-wrap items-center gap-2">
          <button data-focusable data-nav-id="series-primary-action" data-nav-scroll-top
                  data-nav-down={$gameMode ? 'series-quick-episode' : undefined}
                  use:focusOnMount onclick={() => playCta(m)}
                  class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">
            <Play size={16} />{ctaHasProgress(m) ? `Continue · Ep ${ctaEp(m)}` : $offlineMode ? `Play · Ep ${ctaEp(m)}` : 'Play'}
          </button>

          {#if trackerConnected}
            <button data-focusable onclick={() => (showEditor = true)} title="Edit list status"
                    class="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 font-bold transition-colors hover:bg-accent">
              {#if effStatus}
                <span class="size-2.5 rounded-full" style="background:{STATUS_COLOR[effStatus]}"></span>{STATUS_LABEL[effStatus]}
              {:else}
                <BookmarkPlus size={18} /> Add to List
              {/if}
              <ChevronDown size={16} class="opacity-60" />
            </button>
          {/if}

          <button data-focusable onclick={() => void onShare(m)} title="Copy AniList link"
                  class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
            {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
          </button>

          {#if m.trailer?.id}
            <button data-focusable onclick={() => openTrailerPopup(m.trailer!.id!, title(m))} title="Watch trailer"
                    class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
              <Clapperboard size={18} />
            </button>
          {/if}

          <button data-focusable onclick={() => openUrl(`https://anilist.co/anime/${m.id}`)} title="Open on AniList"
                  class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
            AniList<ExternalLink size={14} />
          </button>

          {#if m.idMal}
            <button data-focusable onclick={() => openUrl(`https://myanimelist.net/anime/${m.idMal}`)} title="Open on MyAnimeList"
                    class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
              MAL<ExternalLink size={14} />
            </button>
          {/if}
        </div>
      </div>
    </div>

    <Tabs tabs={['Episodes', 'Relations', 'Cast & Crew', 'Recommended', 'Details']} bind:active />
    {#if active === 'Episodes'}
      <EpisodeList media={m} offline={$offlineMode} />
    {:else if active === 'Relations'}
      {#if m.relations?.edges?.length}
        <div class="flex flex-wrap gap-4">
          {#each m.relations.edges as e (e.node.id)}
            <div class="w-[152px]">
              <div class="mb-1 text-[0.65rem] uppercase text-muted-foreground">{e.relationType.replaceAll('_', ' ').toLowerCase()}</div>
              <SmallCard media={e.node} />
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted-foreground">No related titles.</p>
      {/if}
    {:else if active === 'Cast & Crew'}
      <RichMetadata media={m} view="people" />
    {:else if active === 'Recommended'}
      <RichMetadata media={m} view="recommendations" />
    {:else}
      <div class="max-w-3xl space-y-4">
        {#if m.description}
          <p class="whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}
        <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {#if m.studios?.nodes?.length}
            <div><dt class="font-bold">Studios</dt><dd class="text-muted-foreground">{#each m.studios.nodes as studio, i (studio.id ?? studio.name)}{i ? ', ' : ''}<a data-focusable class="underline-offset-2 hover:underline" href={studio.id ? `/app/search?studio=${studio.id}&name=${encodeURIComponent(studio.name)}` : `/app/search?search=${encodeURIComponent(studio.name)}`}>{studio.name}</a>{/each}</dd></div>
          {/if}
          {#if fmtDate(m.startDate)}
            <div><dt class="font-bold">Start Date</dt><dd class="text-muted-foreground">{fmtDate(m.startDate)}</dd></div>
          {/if}
          {#if m.synonyms?.length}
            <div class="sm:col-span-2"><dt class="font-bold">Synonyms</dt><dd class="text-muted-foreground">{m.synonyms.join(' · ')}</dd></div>
          {/if}
        </dl>
        {#if m.tags?.length}
          <section>
            <h2 class="mb-2 font-black">Themes</h2>
            <MediaTagList tags={m.tags} limit={10} sortByRank />
          </section>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

  {#if showEditor}
    <ListEditor
      media={m}
      initStatus={effStatus}
      initProgress={effProgress}
      initScore0to100={effScore100}
      total={epsTotal(m) || 0}
      {hasEntry}
      onclose={() => (showEditor = false)}
      onsaved={(patch) => (listOpt = { ...listOpt, ...patch })}
    />
  {/if}
{:else if $offlineMode}
  <div class="grid min-h-[50vh] place-items-center p-8 text-center">
    <div class="max-w-sm text-muted-foreground">
      <p class="mb-4">This title isn't available offline. Download episodes while connected to watch them here.</p>
      <a href="/app/downloads" data-focusable class="rounded-md bg-secondary px-4 py-2 text-sm font-bold text-foreground">Go to Downloads</a>
    </div>
  </div>
{:else}
  <div class="p-8 pt-[max(2rem,env(safe-area-inset-top))] text-muted-foreground">Not found.</div>
{/if}
