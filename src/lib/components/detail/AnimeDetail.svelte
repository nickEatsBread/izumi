<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { invoke } from '@tauri-apps/api/core'
  import { ANIME_LIST_ENTRY, MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import EpisodeList from '$lib/components/detail/EpisodeList.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { title, cover, format, status, season, seasonBrowseHref, ratingBg, totalEpisodes, airedCount } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { resumeEpisode, playEpisode, prefetchEpisodeSources, type PlayState } from '$lib/stremio/play'
  import { offlineMode } from '$lib/stores/offline'
  import { downloads, downloadedMedia } from '$lib/downloads/state'
  import { localHistory, sessionProgress, manualProgressOverrides } from '$lib/player/history'
  // Aliased: this file also defines a `seriesTitle` snippet (the rendered <h1>/logo), which would
  // otherwise shadow this helper everywhere in the component — Svelte hoists a markup-level snippet
  // into the same component scope as the script.
  import { seriesTitle as seriesTitleFromItem } from '$lib/downloads/library'
  import { tick, untrack } from 'svelte'
  import { readable, type Readable } from 'svelte/store'
  import { animeEpisodeNumbers, animeResumeEpisode, animeWatchedProgress, recordedWatched, type AnimeDetailState } from '$lib/catalog/anime-detail'
  import { focusOnMount } from '$lib/nav'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { anilistToken } from '$lib/anilist/auth'
  import { kitsuToken, malToken, simklToken } from '$lib/trackers/config'
  import { getExternalTrackerProgress, setScore } from '$lib/trackers'
  import type { AniStatus } from '$lib/trackers'
  import { STATUS_LABEL, STATUS_COLOR } from '$lib/trackers/status'
  import { seriesListEntry, type ListEdit } from '$lib/detail/list-entry'
  import ListEditor from '$lib/components/detail/ListEditor.svelte'
  import ScoreScale from '$lib/components/detail/ScoreScale.svelte'
  import { connectedTrackerLabels } from '$lib/player/series-rating'
  import { incognito } from '$lib/stores/incognito'
  import { ratingOnPage } from '$lib/settings/ui'
  import LocalListPicker from '$lib/components/library/LocalListPicker.svelte'
  import { localLibrary, localTrackingForMedia, localTrackingKey, localTrackingRemoved, mediaIsSaved } from '$lib/library/local-lists'
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus'
  import BookmarkCheck from '@lucide/svelte/icons/bookmark-check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Share2 from '@lucide/svelte/icons/share-2'
  import Clapperboard from '@lucide/svelte/icons/clapperboard'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Play from '@lucide/svelte/icons/play'
  import Download from '@lucide/svelte/icons/download'
  import Check from '@lucide/svelte/icons/check'
  import MoreHorizontal from '@lucide/svelte/icons/ellipsis'
  import { isAndroid, isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import RichMetadata from './RichMetadata.svelte'
  import AiringStatus from './AiringStatus.svelte'
  import MediaTagList from './MediaTagList.svelte'
  import { reliableImage } from '$lib/util/reliable-image'
  import { detailHints, rememberDetail } from '$lib/anilist/detail-hint'
  import { isBackupRecord } from '$lib/anilist/backup-details'
  import { heroBarState } from './hero-bar'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import House from '@lucide/svelte/icons/house'
  import { goto } from '$app/navigation'
  import { acquireEdgeToEdge } from '$lib/actions/edge-to-edge'
  import { suppressBottomNav } from '$lib/shell/chrome'
  import { openTrailerPopup } from '$lib/stores/trailer'
  import { connecting, gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { getKitsuId } from '$lib/anizip'
  import { anilistIdOf, kitsuIdOf, providerExternalUrl } from '$lib/catalog/identity'
  import { detailTrackerLinks } from './tracker-links'
  import TrackerProviderBadge from '$lib/components/settings/TrackerProviderBadge.svelte'
  import { pendingCompanionPlayback, type PendingCompanionPlayback } from '$lib/companion/client'
  import { companionPlaybackTarget } from '$lib/companion/playback'
  import { activeProfile } from '$lib/profiles/store'
  import { profileAllowsAdult, profileAllowsMedia } from '$lib/profiles/content'
  import ParentalBlock from '$lib/components/profiles/ParentalBlock.svelte'
  import { themePresentation } from '$lib/themes/runtime'
  import { episodesBelow, episodesOnSide, resolveDetail, type DetailButton, type DetailSection } from '$lib/themes/presentation'
  import { desktopSynopsis, episodesOnPage, resolveSections, type ResolvedSections } from '$lib/detail/sections'
  import ThemeNode from '$lib/components/themes/ThemeNode.svelte'
  import { mediaDisplayModel } from '$lib/themes/host-model'
  import { ambientFromHex } from '$lib/themes/ambient'
  import { artNeeds, loadTitleExtras, metaNeeds, peekTitleArt, templateNeeds, titleExtrasKey, type TitleExtras } from '$lib/themes/title-extras'
  import { baseImageSrc, detailArt, recordBanner, washBackground } from '$lib/detail/backdrop'
  import { headerImage } from '$lib/detail/header-image'
  import { formatDate as fmtDate, mediaFacts, prettyEnum, type MediaFact } from '$lib/detail/facts'
  import { startDownloadSelect } from '$lib/detail/episode-commands'
  import { singleSeasonLabel } from '$lib/detail/season-label'
  import { fetchSeasonChain, mayListSeasons } from '$lib/anilist/seasons'
  import FactList from './FactList.svelte'
  import AiringCountdown from './AiringCountdown.svelte'
  import { offlineResumeEpisode, playableThrough } from './episode-tile'
  import { flipInGutter } from './toolbar-plan'

  // `id` is a prop (the +page keys this component on it), so navigating anime→relation
  // remounts with the new id and the query re-fetches — a same-route param change alone
  // would NOT re-run a component captured at mount.
  let { id, source }: { id: number; source?: Readable<AnimeDetailState> } = $props()
  const controllerUi = $derived($gameMode || $controllerMode)

  const client = getContextClient()
  // Offline: never touch AniList — feed a static empty store and build media from the local
  // snapshot instead. Recreating the real queryStore on reconnect refetches automatically.
  const EMPTY_STORE = readable(
    { fetching: false, error: undefined, data: undefined } as {
      fetching: boolean; error?: { message: string }; data?: { Media: Media }
    },
  )
  const store = $derived(
    $offlineMode ? EMPTY_STORE : source ?? queryStore<{ Media: Media }>({ client, query: MEDIA_BY_ID, variables: { id } }),
  )
  // A provider owns the metadata and playback id. When mapped, AniList still owns the viewer's
  // AniList entry; loading that optional entry must never gate the provider's detail page.
  const mappedId = $derived(source && $store.data?.Media ? anilistIdOf($store.data.Media) : undefined)
  const EMPTY_ENTRY = readable<{ data?: { Media: Pick<Media, 'mediaListEntry'> | null } }>({})
  const mappedEntryStore = $derived(!$offlineMode && $anilistToken && mappedId
    ? queryStore<{ Media: Pick<Media, 'mediaListEntry'> | null }>({ client, query: ANIME_LIST_ENTRY, variables: { id: mappedId } })
    : EMPTY_ENTRY)
  const rawEntry = $derived($mappedEntryStore.data?.Media?.mediaListEntry ?? $store.data?.Media?.mediaListEntry)

  // REST-tracker read-back: merge MAL, Kitsu, and Simkl into the AniList media so progress shows
  // even when the user does not use AniList. Take whichever connected tracker is further
  // along. `media` is what the whole page renders — badge, resume, episode marks.
  let externalEntry = $state<{ progress: number; status?: AniStatus; score: number } | null>(null)
  // NOT $state, and it must stay that way. This is a bookkeeping latch, not UI state: the effect
  // both READS it (the guard) and WRITES it, so as $state the write re-triggered the effect, and
  // Svelte runs an effect's teardown before re-running it — the teardown cancelled the tracker request
  // the same pass had just started, so the result never landed. Symptom: tracker read-back was dead on
  // every detail page (no status pill or progress), which reads as "Add to List" on a title
  // that is already on the user's list.
  let externalEntryFor = ''
  $effect(() => {
    // Guard on title ids + connection set so an unrelated store emission doesn't refetch: without
    // it a tracker-only user watched the header badge fall back to "0/12" and the CTA revert from "Continue · Ep 8" to
    // "Play" for one MAL round-trip on every emission.
    const current = $store.data?.Media
    const key = current
      ? `${current.id}:${anilistIdOf(current) ?? ''}:${current.idMal ?? ''}:${kitsuIdOf(current) ?? ''}:${!!$malToken}:${!!$kitsuToken}:${!!$simklToken}`
      : ''
    if (key === externalEntryFor) return
    externalEntryFor = key
    externalEntry = null
    if (!current) return
    // Accept the response only if it is still the title we asked about. Snapshotting the key beats
    // an effect-scoped `cancelled` flag here, because ANY re-run of this effect (urql emits several
    // times per query) would fire that flag's teardown and drop an in-flight request.
    getExternalTrackerProgress(anilistIdOf(current) ?? current.id, current.idMal ?? undefined, kitsuIdOf(current)).then((entry) => {
      if (externalEntryFor === key) externalEntry = entry
    })
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
      id, title: { userPreferred: seriesTitleFromItem(doneItems[0]?.title ?? '') },
      coverImage: { extraLarge: doneItems[0]?.poster },
    } as Media)
    const progress = Math.max($localHistory[id]?.progress ?? 0, base.mediaListEntry?.progress ?? 0)
    return { ...base, mediaListEntry: { ...(base.mediaListEntry ?? {}), progress } } as Media
  })

  const media = $derived.by(() => {
    if ($offlineMode) return offlineMedia
    const base = $store.data?.Media
    if (!base) return base
    const local = localTrackingForMedia($localLibrary, base)
    const progress = Math.max(rawEntry?.progress ?? 0, externalEntry?.progress ?? 0, local?.progress ?? 0)
    return { ...base, mediaListEntry: { ...rawEntry, progress, status: local?.status ?? rawEntry?.status ?? externalEntry?.status } }
  })
  const detailHint = $derived($detailHints[id])
  // While the detail query runs with nothing cached, the page is the theme's real page, drawn from
  // what the card the user tapped already showed (or a placeholder that knows only the id), with
  // `data-pending` on it: every hook and element is where the loaded page puts it, so nothing
  // re-lays out, and the artwork painted while loading is the artwork the page keeps. The card's
  // record never reaches the data components (episodes, relations, the list editor), and no action
  // runs on it (see `ready`).
  const pending = $derived(!$offlineMode && !media && $store.fetching)
  // A profile that may not see this title must not see the card's art and title either; one that
  // excludes adult titles also skips a card that cannot say whether the title is one.
  const hintFits = (hint: Media | undefined): hint is Media => !!hint && profileAllowsMedia(hint, $activeProfile)
    && (hint.isAdult != null || profileAllowsAdult($activeProfile))
  const shown = $derived(media ?? (pending ? (hintFits(detailHint) ? detailHint : ({ id, title: {}, coverImage: {} } as Media)) : undefined))
  // A title known by name: a placeholder has none, and `title()` would print "TBA".
  const named = (m: Media) => !!(m.title.romaji || m.title.english || m.title.userPreferred)
  // A loading page without a name holds placeholder lines; a loaded record without one is not still
  // loading (an offline title rebuilt from its downloads), so it keeps the text it always had.
  const unnamed = (m: Media) => pending && !named(m)
  // Display reads `shown`; every action needs the full record. Pressed before it lands, an action
  // does nothing, except Play, which waits for it (`pressPlay`).
  const ready = <T extends unknown[]>(run: (m: Media, ...args: T) => void) => (...args: T) => { if (media) run(media, ...args) }
  // AniList does not expose Kitsu IDs. AniZip is already the detail page's episode-metadata
  // mapping source, so reuse its cached per-title mapping to make the Kitsu destination exact.
  // Looked up per title id, never per `media` object: the page builds a new one each time its query
  // delivers the same series again (a cached page's revalidation, each wave of the season picker's
  // chain walk, a tracker read-back). Re-running on those cleared the id until IndexedDB answered,
  // which took the Kitsu button out of the page and put it back, dropping a d-pad focus resting on it.
  const mediaKitsuId = $derived(media ? kitsuIdOf(media) : undefined)
  const mediaAnilistId = $derived(media ? anilistIdOf(media) : undefined)
  let externalKitsuId = $state<number | undefined>()
  $effect(() => {
    const direct = mediaKitsuId
    if (direct) { externalKitsuId = direct; return }
    const requestedId = mediaAnilistId
    externalKitsuId = undefined
    if (requestedId == null || requestedId <= 0) return
    let cancelled = false
    void getKitsuId(requestedId).then((value) => {
      if (!cancelled && mediaAnilistId === requestedId) externalKitsuId = value
    })
    return () => { cancelled = true }
  })
  const externalTrackerLinks = $derived.by(() => media ? detailTrackerLinks(media, {
    anilist: Boolean($anilistToken),
    mal: Boolean($malToken),
    kitsu: Boolean($kitsuToken),
    simkl: Boolean($simklToken),
  }, externalKitsuId) : [])
  // The AniList banner seen for this title: the card the user tapped, then any AniList record of it
  // this page showed. While AniList is unavailable the detail record comes from the fallback catalog,
  // which has no banner for about half of the titles that have one, so the page keeps this one
  // rather than trading the real art for a stand-in.
  let anilistBanner = $state(untrack(() => (source ? undefined : $detailHints[id]?.bannerImage)))
  // Whether the record is the fallback catalog's (backup-details.ts): the query does not select the
  // record's catalog identity, so the page asks which answer it shows. Re-read with each delivery.
  const backupRecord = $derived(!source && !!media && isBackupRecord(id))
  $effect(() => {
    if (!source && media && !backupRecord && media.bannerImage) anilistBanner = media.bannerImage
  })
  $effect(() => {
    if (!media) return
    // Nor does the fallback record overwrite the banner the next visit's hint carries.
    const keep = backupRecord && !media.bannerImage ? untrack(() => anilistBanner) : undefined
    rememberDetail(keep ? { ...media, bannerImage: keep } : media)
  })

  // Match the episode list's progress ownership. Tracker queries can still be stale when Android
  // returns from the player, while session/local history has already recorded the completed episode.
  const watchedThrough = $derived(shown
    ? animeWatchedProgress(shown, $localHistory, $sessionProgress, $manualProgressOverrides)
    : 0)

  // Resume target for the hero CTA. Offline = the first DOWNLOADED episode past the progress the
  // episode list shows (else the first downloaded), by the rule the Continue card uses too
  // (episode-tile.ts) — never resumeEp(), which could point at an episode that isn't on disk.
  // `playCta` also routes offline through playEpisode (the local swap) instead of resumeEpisode
  // (which would fire a live fetchMediaById + online resolve).
  function offlineResumeEp(m: Media): number {
    return offlineResumeEpisode(downloadedEpisodes(m), watchedThrough)
  }
  const ctaEp = (m: Media) => {
    if ($offlineMode) return offlineResumeEp(m)
    return animeResumeEpisode(m, watchedThrough)
  }
  const ctaHasProgress = (m: Media) => ($offlineMode ? (m.mediaListEntry?.progress ?? 0) : watchedThrough) > 0
  // API 4 play states: every Play button carries `data-state` (`start`, `resume`) and `data-episode`
  // (the episode it opens), so a stylesheet can word it its own way ("Resume E3").
  const ctaState = (m: Media) => (ctaHasProgress(m) ? 'resume' : 'start')
  function playCta(m: Media, haptic = true) {
    if (haptic) h.impact('medium')
    prefetchEpisodeSources(m, ctaEp(m), 0)
    if ($offlineMode) playEpisode(m, offlineResumeEp(m), (s) => (heroPlay = s))
    else resumeEpisode(m, ctaEp(m), (s) => (heroPlay = s))
  }
  // Play pressed while the record loads: the connecting screen comes up at once (cancel drops the
  // press), and playback starts when the record lands, if the page is still open.
  let playWhenReady = $state(false)
  function pressPlay() {
    if (media) { playCta(media); return }
    if (playWhenReady || !shown) return
    h.impact('medium')
    playWhenReady = true
    heroPlay = { status: 'resolving' }
    connecting.set({
      title: named(shown) ? title(shown) : '',
      art: cover(shown) || undefined,
      cancel: () => { connecting.set(null); playWhenReady = false; heroPlay = { status: 'idle' } },
    })
  }
  $effect(() => {
    if (!playWhenReady) return
    if (media) {
      playWhenReady = false
      const target = media
      // No second haptic: the press gave one when it was made.
      untrack(() => playCta(target, false))
    } else if (!pending) {
      // The record never came (an error): drop the press with the screen it raised.
      playWhenReady = false
      heroPlay = { status: 'idle' }
      connecting.set(null)
    }
  })
  $effect(() => () => { if (playWhenReady) connecting.set(null) })
  // Hovering or focusing Play warms the sources it would play. Before the record lands there is
  // nothing to warm with; remember the button and warm once it lands if the pointer or focus is
  // still there (a controller lands on Play while the page loads). Plain, not $state: only the
  // record's arrival should run the check.
  let warmOnLoad: HTMLElement | null = null
  function warmPlay(event: Event) {
    if (media) prefetchEpisodeSources(media, ctaEp(media))
    else warmOnLoad = event.currentTarget as HTMLElement
  }
  $effect(() => {
    if (!media || !warmOnLoad) return
    const button = warmOnLoad
    const target = media
    warmOnLoad = null
    if (button.isConnected && (button.matches(':hover') || button === document.activeElement)) untrack(() => prefetchEpisodeSources(target, ctaEp(target)))
  })

  // The tab the viewer picked; until then, or when that tab is gone, the theme's default (`shownTab`).
  let pickedTab = $state('')
  let heroPlay = $state<PlayState>({ status: 'idle' })
  const detailTheme = $derived(resolveDetail($themePresentation))
  // The series' cover colour for theme stylesheets (`--cover-rgb`).
  const coverRgb = $derived(ambientFromHex(shown?.coverImage?.color))
  // API 3 extras the series page binds: key art (behind every series-page header: first with
  // `detail.art: "keyart"`, otherwise in place of a missing or broken banner), the title logo
  // (`detail.title`) and whatever the header template shows (an age rating, audio).
  const detailNeeds = $derived.by(() => {
    // The facts and actions-row templates bind what the header template does (an age rating).
    const needs = templateNeeds(detailTheme.header, detailTheme.facts, detailTheme.actionsLead)
    needs.add('keyart')
    if (detailTheme.title === 'logo' || detailTheme.bar?.title === 'logo') needs.add('logo')
    // API 4 `detail.art: "portrait"`: the full-resolution poster after key art (the same lookup).
    if (detailTheme.art === 'portrait') needs.add('posterHd')
    return needs
  })
  // The lookups start with the page, on the card's record or on the placeholder (which carries the
  // route's AniList id), so key art and the logo load while the detail query runs, and also while
  // AniList is unavailable. The full record runs them again only when it brings something they read
  // that the card did not (a provider logo, a MyAnimeList id), and its results merge into what is
  // there; only a new title starts over.
  const extrasInputs = $derived(shown ? titleExtrasKey(shown) : '')
  let detailExtras = $state<TitleExtras>({})
  // Whether the artwork (key art, the logo) has arrived or is no longer waited for: at most 1.2 s from
  // the page's arrival, so the page does not swap text → logo. The age rating and audio come from
  // slower, rate-limited lookups and fill in whenever they land. Unsettled until the effect below has
  // looked: the first render must not pick the wash for a title whose key art is about to load.
  let detailExtrasSettled = $state(false)
  let failedDetailLogo = $state('')
  // Plain, not $state: the effect below both reads and writes them.
  let extrasTitle: number | undefined
  let artDeadline: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    void extrasInputs
    const needs = detailNeeds
    const offline = $offlineMode
    const target = untrack(() => shown)
    const art = artNeeds(needs)
    const meta = metaNeeds(needs)
    if (!target || !needs.size || offline) { detailExtrasSettled = true; return }
    if (target.id !== extrasTitle) {
      extrasTitle = target.id
      clearTimeout(artDeadline)
      // Artwork an earlier visit found paints on the first frame.
      const found = peekTitleArt(anilistIdOf(target))
      detailExtras = found ? Object.fromEntries(Object.entries(found).filter(([need]) => art.has(need as keyof TitleExtras))) : {}
      detailExtrasSettled = !art.size || !!found
      if (!detailExtrasSettled) artDeadline = setTimeout(() => (detailExtrasSettled = true), 1200)
    }
    let cancelled = false
    if (art.size) {
      void loadTitleExtras(target, art).then((value) => {
        if (cancelled) return
        detailExtras = { ...detailExtras, ...value }
        detailExtrasSettled = true
      })
    }
    // A placeholder has no title for the schedule lookup to match; the record brings one.
    if (meta.size && named(target)) {
      void loadTitleExtras(target, meta).then((value) => {
        if (!cancelled) detailExtras = { ...detailExtras, ...value }
      })
    }
    return () => { cancelled = true }
  })
  $effect(() => () => clearTimeout(artDeadline))
  // The header artwork, one choice for every layout and for the loading and loaded page alike
  // (backdrop.ts): the banner, key art, a placeholder while the choice still waits, or a wash of the
  // cover's colour. Never a trailer still or a blurred photograph.
  let failedBackdrops = $state<string[]>([])
  // Called once an image has failed its retries (`reliableImage`); the next candidate takes its place.
  const backdropFailed = (src: string | null | undefined) => {
    const failed = baseImageSrc(src)
    if (failed && !failedBackdrops.includes(failed)) failedBackdrops = [...failedBackdrops, failed]
  }
  const headerArt = $derived(detailArt({
    banner: recordBanner(shown, { loading: pending, anilistBanner, backup: backupRecord }),
    keyart: detailExtras.keyart,
    keyartPending: !detailExtrasSettled,
    themeArt: detailTheme.art,
    // API 4: the portrait art (`art: "portrait"`) and the sharp cover fallback (`artFallback`).
    poster: detailExtras.posterHd,
    cover: (shown && cover(shown)) || undefined,
    fallback: detailTheme.artFallback,
    failed: failedBackdrops,
    rgb: coverRgb,
  }))
  const headerSrc = $derived('src' in headerArt ? headerArt.src : '')
  const headerWash = $derived(headerArt.kind === 'wash' ? washBackground(headerArt.rgb) : undefined)
  const detailLogo = $derived(detailTheme.title === 'logo' && detailExtras.logo && detailExtras.logo !== failedDetailLogo ? detailExtras.logo : '')
  // API 4 `detail.bar.title: "logo"`: the scrolled bar shows the title logo, when there is one.
  const barLogo = $derived(detailTheme.bar?.title === 'logo' && detailExtras.logo && detailExtras.logo !== failedDetailLogo ? detailExtras.logo : '')
  const factsStyle = $derived(detailTheme.factsStyle ?? 'template')
  // What a facts template (`detail.facts`) binds, on phones and desktop alike, with the episodes the
  // viewer has watched (API 4 `episodesWatched`; set from a list entry even at 0, else once one is)
  // and the title extras its template asks for (an age rating), as the header template gets them.
  const factsModel = (m: Media) => mediaDisplayModel(m, { reviews: m.popularity ? String(m.popularity) : undefined, episodesWatched, ...detailExtras })
  // The countdown with the facts. API 4 `countdownAt: "episodes"` moves it to the top of the episode
  // list (EpisodeList), which also draws it for `both`.
  const countdown = $derived(detailTheme.countdownAt === 'episodes' ? 'none' : detailTheme.countdown ?? 'none')
  // API 3 `detail.column: "poster"`: the poster heads a left column (trailer, countdown, facts) that
  // runs down beside the title, actions, synopsis and sections — desktop stacked and split pages.
  const posterColumn = $derived(detailTheme.column === 'poster')
  const downloadedEpisodes = (m: Media) => Object.values($downloads)
    .filter((d) => d.mediaId === m.id && d.status === 'done').map((d) => d.episode).sort((a, b) => a - b)
  // The episodes the list shows (EpisodeList's own rule): the downloaded ones offline.
  const listEpisodes = (m: Media) => ($offlineMode ? downloadedEpisodes(m) : animeEpisodeNumbers(m))
  const overlayDetail = $derived(detailTheme.layout === 'overlay')
  const bannerOverlap = $derived(detailTheme.bannerHeight ? Math.round(detailTheme.bannerHeight * 0.58) : (controllerUi ? 16 : 18))
  const sideEpisodes = $derived(episodesOnSide($themePresentation, !$isMobile))
  const belowEpisodes = $derived(episodesBelow($themePresentation, !$isMobile))
  const episodeTabbed = $derived(!sideEpisodes && !belowEpisodes)
  // Which sections get a tab, their names and order, the tab open on arrival, and whether phones
  // move the facts into Overview (API 3 `detail.sections`); without it, izumi's own tabs.
  const desktopTabs = $derived(resolveSections(detailTheme.sections, { phone: false, episodesTabbed: episodeTabbed }))
  const mobileTabs = $derived(resolveSections(detailTheme.sections, { phone: true, episodesTabbed: episodeTabbed }))
  // Desktop: once a theme composes the sections, the synopsis shows in the info column or in Overview
  // (`info: "overview"`), never both; izumi's own page keeps a short one above and the whole text in Details.
  const synopsisAt = $derived(desktopSynopsis(detailTheme.sections))
  const shownTab = (view: ResolvedSections): DetailSection => view.tabs.find((tab) => tab === pickedTab) ?? view.initial
  // API 3 `detail.continue: "card"`: on phones the Continue card at the top of the episodes takes
  // the header Play button's place, once an episode can play (the card needs one to show) and only
  // while the episodes are on the page: with another tab open, the header keeps its Play button.
  const headerCtaHidden = $derived(shown != null && $isMobile && detailTheme.continue === 'card'
    && episodesOnPage(mobileTabs, shownTab(mobileTabs), !episodeTabbed)
    && playableThrough(listEpisodes(shown), airedCount(shown), $offlineMode) > 0)
  // A flip order drawn as the round button in the list's gutter (beside a right-hand rail, or with
  // izumi's own toolbar) leaves no toolbar line for release timing, so the info column shows it.
  const flipGutter = $derived(shown != null && flipInGutter({ ...detailTheme.episodes, total: listEpisodes(shown).length, phone: $isMobile, rail: sideEpisodes }))
  // API 4 `detail.buttons`: the phone header's buttons, in the theme's order. izumi's own is Play, with
  // the full-width list button after it under `listButton: "full"` (the overlay body has Play only).
  const headerButtons = $derived<DetailButton[]>(detailTheme.buttons ?? (detailTheme.listButton === 'full' && !overlayDetail ? ['play', 'list'] : ['play']))
  // Download needs an episode to download: none offline (the list there is what is on disk), and none
  // before the first episode airs. While loading it holds its place.
  const downloadable = $derived(shown != null && !$offlineMode && (pending || playableThrough(listEpisodes(shown), airedCount(shown), false) > 0))
  const shownButtons = $derived(headerButtons.filter((button) => button === 'play' ? !headerCtaHidden : button === 'download' ? downloadable : true))
  // The header's Download: the episode list's download selection with the Play episode picked. With
  // the episodes in another tab, that tab opens and its list takes the request (episode-commands.ts).
  function downloadCta(m: Media) {
    h.tap()
    if (startDownloadSelect(ctaEp(m), m.id)) return
    if (mobileTabs.tabs.includes('episodes')) pickedTab = 'episodes'
    else if (mobileTabs.folded.includes('episodes')) pickedTab = 'overview'
  }

  // A TV request already chose the title/episode. Once its detail data is ready, open the same
  // source picker as a local Play press; selecting (or auto-selecting) a source then consumes the
  // pending target in startPendingCompanionCast and sends that source to the TV.
  let startedCompanionRequest: PendingCompanionPlayback | null = null
  $effect(() => {
    // (Shadows the page's `pending` here: this is the TV's request.)
    const pending = $pendingCompanionPlayback
    const current = media
    if (!pending || pending.headless || !current || pending === startedCompanionRequest) return
    const target = companionPlaybackTarget(
      pending.media,
      current,
      current.format === 'MOVIE' ? undefined : ctaEp(current),
    )
    if (!target) return
    startedCompanionRequest = pending
    prefetchEpisodeSources(current, target.episode, 0)
    void playEpisode(current, target.episode, (state) => (heroPlay = state), {
      forceManual: pending.media.playback?.selection === 'manual',
      companion: true,
      hidden: pending.media.playback?.selection === 'manual',
      remoteOnly: true,
      autoplay: true,
      startSeconds: pending.media.playback?.positionSeconds,
    })
  })

  // Action-bar transient/optimistic state.
  let copied = $state(false)
  let showMore = $state(false)      // mobile action overflow menu
  // List-editor state. `listOpt` is the optimistic patch applied after a save so the status pill +
  // progress badge reflect instantly (the tracker queue reconciles every connected service).
  let showEditor = $state(false)
  // The desktop action-bar button; the editor anchors its popover to it (phones get a sheet).
  let editorAnchor = $state<HTMLButtonElement>()
  let showLocalLists = $state(false)
  let listOpt = $state<ListEdit>({})
  // Read from `shown`, so the list status and Save labels are right while the record loads.
  const localEntry = $derived(shown ? localTrackingForMedia($localLibrary, shown) : undefined)
  // This page is only hidden while the player is up, so the edit above and the tracker reads predate
  // any episode watched there. Episodes this device records after the page read them (or saved an
  // edit) are newer than both; `seriesListEntry` moves the count up to them.
  const watched = $derived(media ? recordedWatched(media, $localHistory, $sessionProgress) : 0)
  let watchedBefore = $state<number | null>(null)
  $effect(() => { if (media && untrack(() => watchedBefore) == null) watchedBefore = watched })
  // The optimistic edit wins outright until an episode is watched after it, and a manual override
  // wins outright; between the trackers take the max.
  const listEntry = $derived(seriesListEntry({
    edit: listOpt, local: localEntry, anilist: rawEntry, external: externalEntry,
    locallyRemoved: !!media && localTrackingRemoved($localLibrary, media),
    override: $manualProgressOverrides[id], watched, watchedBefore,
  }))
  const entryRemoved = $derived(listEntry.removed)
  const effStatus = $derived(listEntry.status)
  const effProgress = $derived(listEntry.progress)
  const effScore100 = $derived(listEntry.score100)
  // API 4 `episodesWatched` for the series templates: a list entry's count even at 0, else the
  // episodes watched once there are any (the rule cards follow, series-progress.ts).
  const episodesWatched = $derived(effStatus || effProgress > 0 ? effProgress : undefined)
  const hasEntry = $derived(!!effStatus)
  const canRemove = $derived(!entryRemoved && (hasEntry || (!!media && Object.values($localHistory)
    .some((entry) => localTrackingKey(entry.media) === localTrackingKey(media)))))
  const savedLocally = $derived(shown ? mediaIsSaved($localLibrary, shown) : false)
  // "Your rating" sits on the page itself once the viewer has actually watched something — rating a
  // title from the plan-to-watch pile is noise, and before this the score was only reachable three
  // clicks deep inside the list editor and never shown anywhere.
  const rateable = $derived((!!effStatus && effStatus !== 'PLANNING') || effProgress > 0)
  const effScore10 = $derived(Math.round(effScore100 / 10))
  // The viewer decides whether the row lives on the page: always (once started), only after they
  // have rated, or never (rating then happens in the list editor alone).
  const showRatingRow = $derived($ratingOnPage === 'always' ? rateable || effScore10 > 0
    : $ratingOnPage === 'rated' ? effScore10 > 0
    : false)
  const ratingHint = $derived.by(() => {
    if ($incognito) return 'Incognito — ratings are not saved'
    const trackers = connectedTrackerLabels()
    return trackers.length ? `Saved to ${trackers.join(' · ')}` : 'Saved on this device'
  })
  function rate(m: Media, score10: number) {
    // Optimistic: the scale reflects the click at once; setScore queues + retries every tracker.
    listOpt = { ...listOpt, score: score10 * 10, removed: false }
    void setScore(m, score10 * 10)
  }

  const stripHtml = (s?: string) => (s ? s.replace(/<[^>]+>/g, '') : '')
  const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  // The watched line of the facts ("3/12"), once there is progress.
  const progressFact = (m: Media) => (effProgress > 0 ? `${effProgress}/${epsTotal(m) || '?'}` : undefined)
  // The phone Information grid (API 4 `detail.infoKeys`, `factsLabels`, `factsFormat`); without keys,
  // its own facts and wording. While loading, a fact the card cannot fill holds a placeholder.
  const infoFacts = (m: Media) => mediaFacts(m, { place: 'info', keys: detailTheme.infoKeys, labels: detailTheme.factsLabels, format: detailTheme.factsFormat, progress: progressFact(m), pending })
  // API 4 `detail.actionsLead`: the template at the start of the phone actions row. Its `episodeCount`
  // is the catalog's count, else the episodes aired so far: never the airing schedule's last episode,
  // which falls below what has aired on a long runner ("Total of 1180 / 1147").
  const leadModel = (m: Media) => {
    const model = factsModel(m)
    const aired = airedCount(m)
    const total = m.episodes || (Number.isFinite(aired) && aired > 0 ? aired : model.episodesAired)
    return { ...model, episodeCount: total ? String(total) : undefined }
  }

  // The phone synopses: the one with the facts (`info`), the overlay page's (`body`) and Overview's
  // whole text (`overview`). Each opens on its own; tapping the facts' one toggles it, as always.
  type SynopsisPlace = 'info' | 'body' | 'overview'
  let synopsisOpen = $state<Record<SynopsisPlace, boolean>>({ info: false, body: false, overview: false })
  // API 4 `detail.synopsis`: a "more" control after a synopsis the stylesheet clamps, shown only
  // while the clamp actually cuts the text (or while it is open, to close it again).
  const synopsisMore = $derived(detailTheme.synopsis?.more ?? 'none')
  const SYNOPSIS_MORE = { more: 'More', 'read-more': 'Read more', 'show-more': 'Show more' } as const
  const synopsisLabel = $derived(SYNOPSIS_MORE[detailTheme.synopsis?.label ?? 'more'])
  let synopsisClamped = $state<Partial<Record<SynopsisPlace, boolean>>>({})
  function toggleSynopsis(place: SynopsisPlace) {
    synopsisOpen = { ...synopsisOpen, [place]: !synopsisOpen[place] }
  }
  // Measures whether the text overflows its clamp, again whenever its box or text changes.
  function clampWatch(node: HTMLElement, options: { place: SynopsisPlace; more: string; text?: string }) {
    let current = options
    const measure = () => {
      const { place, more } = current
      if (more === 'none' || synopsisOpen[place]) return
      const clamped = node.scrollHeight > node.clientHeight + 1
      if (!!synopsisClamped[place] !== clamped) synopsisClamped = { ...synopsisClamped, [place]: clamped }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return {
      // Untracked: the measurement reads and writes the clamp state, which is no input of the action.
      update(next: typeof options) { current = next; untrack(measure) },
      destroy() { observer.disconnect() },
    }
  }
  // The whole synopsis in Overview, for `more: "tab"`.
  let overviewSynopsis = $state<HTMLElement>()
  // `tab` opens Overview and brings its whole text under the bar; where the clamped text is
  // Overview's own (or there is no Overview), the control opens it in place, like `expand`.
  const opensOverview = (place: SynopsisPlace) => synopsisMore === 'tab' && place !== 'overview'
    && mobileTabs.tabs.includes('overview') && (overlayDetail || !mobileTabs.infoInOverview)
  function pressSynopsisMore(place: SynopsisPlace) {
    h.tap()
    if (!opensOverview(place)) { toggleSynopsis(place); return }
    pickedTab = 'overview'
    void tick().then(() => { if (overviewSynopsis) revealUnderBar(overviewSynopsis) })
  }
  // A tap on the clamped text does what its control does: with `more: "tab"` it opens Overview as
  // well. Otherwise, and on text the clamp does not cut, it toggles in place, as it always has.
  function tapSynopsis(place: SynopsisPlace) {
    if (opensOverview(place) && synopsisClamped[place] && !synopsisOpen[place]) pressSynopsisMore(place)
    else toggleSynopsis(place)
  }
  // Scrolls `element` to just under what stays pinned at the top: the floating bar, and a tab strip a
  // theme pins under it.
  function revealUnderBar(element: HTMLElement) {
    let covered = 0
    for (const pinned of document.querySelectorAll<HTMLElement>('[data-slot="detail.bar"], [data-part="tabs"]')) {
      const style = getComputedStyle(pinned)
      const box = pinned.getBoundingClientRect()
      if (style.position === 'fixed' && box.top < window.innerHeight / 2) covered = Math.max(covered, box.bottom)
      else if (style.position === 'sticky') covered = Math.max(covered, (parseFloat(style.top) || 0) + box.height)
    }
    const top = element.getBoundingClientRect().top + window.scrollY - covered - 8
    const reduced = document.documentElement.dataset.motion === 'reduced'
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' })
  }

  // The one season the episode list shows, named on the Episodes heading (API 4 `data-season-label`)
  // for a theme that titles it "Season 1" or "Specials". Under a season picker the chain it walks
  // (the same cached walk) decides; otherwise the record's own prequel and sequel links do.
  const seasonRoot = $derived(media && !$offlineMode && (detailTheme.episodes?.seasons ?? 'none') !== 'none' && mayListSeasons(media.format) ? anilistIdOf(media) : undefined)
  let seasonChain = $state<Media[] | undefined>()
  $effect(() => {
    const root = seasonRoot
    seasonChain = undefined
    if (root == null) return
    const seed = untrack(() => (media && !media.catalog ? media : undefined))
    let cancelled = false
    fetchSeasonChain(root, seed).then((chain) => { if (!cancelled) seasonChain = chain }, () => {})
    return () => { cancelled = true }
  })
  const seasonLabel = $derived(media ? singleSeasonLabel(media, seasonChain) : undefined)

  // Total episodes for the badge — schedule-aware so OVAs/ONAs with a null AniList count
  // still show a number (see totalEpisodes).
  const epsTotal = totalEpisodes
  async function onShare(m: Media) {
    const url = providerExternalUrl(m) ?? title(m)
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
  // full opacity reads as a glitch. Fade on decode instead, keyed to the URL whose image loaded — not a
  // flag reset when `media` changes: `media` is a new object whenever the detail query delivers the
  // same series again (a cached page's revalidation, the season picker's chain walk), and an unchanged
  // image never fires `load` again, so that reset hid the banner for good. New artwork is a new URL.
  // The loading page paints the same <img> the loaded page keeps, so artwork it already showed stays.
  let loadedArt = $state('')
  const artReady = (src: string | null | undefined) => !!src && src === loadedArt
  const markArtLoaded = (event: Event & { currentTarget: EventTarget & Element }) => {
    loadedArt = baseImageSrc(event.currentTarget.getAttribute('src'))
  }
  // The poster keeps a cover-shaped placeholder until its image has loaded: a placeholder page has no
  // cover yet, and an image still loading has no height, so the title row would jump when it lands.
  // A blank image stands in for a missing cover, so no broken-image icon is drawn.
  const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  let loadedPoster = $state('')
  const posterSrc = (m: Media) => cover(m) || BLANK_IMAGE
  const posterWaiting = (m: Media) => (cover(m) ? loadedPoster !== cover(m) : pending)
  const markPosterLoaded = (event: Event & { currentTarget: EventTarget & Element }) => {
    loadedPoster = baseImageSrc(event.currentTarget.getAttribute('src'))
  }
  // `wasSolid` is deliberately a plain `let`, NOT $state: the scroll handler both reads and writes
  // it to resolve the hysteresis, and a reactive latch read+written by its own effect is a cycle
  // Svelte resolves as an update loop, not a settled value (same trap as malEntryFor above).
  let wasSolid = false
  let barState = $state({ solid: false, showTitle: false })
  function onHeroScroll() {
    const next = heroBarState(window.scrollY, artHeight, barHeight, wasSolid, detailTheme.bar?.solidAt)
    // Nothing to publish while the state is unchanged — which is every scroll frame but two. This
    // also keeps the bar off the reactive graph during a fling.
    if (next.solid === wasSolid) return
    wasSolid = next.solid
    barState = next
  }
  // Acquired for every branch on mobile, not just once the hero has loaded — gating this on `media`
  // made the page jump by the status-bar height the instant the skeleton was replaced by the loaded
  // hero. The failure branches carry the bar too (`failureBar`), so a page without the bottom
  // navigation never strands the user.
  // Shared with the settings layout via a refcount: their lifetimes can overlap mid-navigation.
  $effect(() => {
    if (!$isMobile) return
    return acquireEdgeToEdge()
  })
  // API 3 `detail.nav: "hidden"`: the series page covers the phone's bottom navigation, like a page
  // pushed over an app's tab bar. The claim is released on leave or when the theme changes.
  $effect(() => {
    if (!$isMobile || detailTheme.nav !== 'hidden') return
    return suppressBottomNav()
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
  // The AniList query can be asked again; a provider's detail source has no retry of its own.
  const retryable = $derived(!source && 'reexecute' in store)
  function retryDetail() {
    h.tap()
    const query = store as { reexecute?: (context: { requestPolicy: 'network-only' }) => void }
    query.reexecute?.({ requestPolicy: 'network-only' })
  }
</script>

<svelte:window onscroll={$isMobile ? onHeroScroll : undefined} onkeydown={(e) => { if (e.key === 'Escape' && showMore) showMore = false }} />

{#if !pending && !$offlineMode && $store.error}
  {#if $isMobile}{@render failureBar()}{/if}
  <div class="p-8 text-muted-foreground {$isMobile ? 'pt-[calc(4rem+env(safe-area-inset-top))]' : 'pt-[max(2rem,env(safe-area-inset-top))]'}">
    <p>Failed to load: {$store.error.message}</p>
    {#if retryable}
      <button type="button" data-focusable onclick={retryDetail}
              class="mt-4 rounded-md bg-secondary px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-accent">Try again</button>
    {/if}
  </div>
{:else if media && !profileAllowsMedia(media, $activeProfile)}
  <ParentalBlock />
{:else if shown}
  {@const m = shown}
  {#if $isMobile && overlayDetail}
    <div data-slot="detail" data-layout="overlay" data-variant="phone" data-pending={pending || undefined} style:--cover-rgb={coverRgb} class="relative pb-8">
      <div data-slot="detail.bar" data-solid={barState.solid || undefined} bind:clientHeight={barHeight}
           class="fixed inset-x-0 top-0 z-30 flex items-center gap-2 px-2 py-2 transition-colors duration-200
                  {barState.solid ? 'border-b border-border bg-background/80 backdrop-blur' : 'text-white'}"
           style="padding-top:max(0.5rem,env(safe-area-inset-top))">
        {#if !barState.solid}
          <div data-part="detail.bar.scrim" class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/55 to-transparent"></div>
        {/if}
        <button data-part="detail.back" data-focusable onclick={heroBack} aria-label="Back"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/15">
          <ChevronLeft size={22} />
        </button>
        {#if detailTheme.bar?.home}{@render barHome()}{/if}
        {#if barState.showTitle && named(m)}
          <span data-part="detail.bar.title" class="min-w-0 flex-1 truncate text-base font-black">{#if barLogo}<img data-part="detail.bar.logo" src={barLogo} alt={title(m)} onerror={() => (failedDetailLogo = barLogo)} class="block h-8 w-auto max-w-full object-contain object-left" />{:else}{title(m)}{/if}</span>
        {/if}
      </div>
      <div data-slot="detail.banner" data-art={headerArt.kind} bind:clientHeight={artHeight} style:background-image={headerWash} class="relative min-h-[56vh] w-full overflow-hidden">
        {#if headerSrc}
          <img data-part="detail.backdrop" data-art={headerArt.kind} use:headerImage={{ src: headerSrc, onfailed: backdropFailed }} alt="" onload={markArtLoaded}
               class="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 {artReady(headerSrc) ? 'opacity-100' : 'opacity-0'}"
               style="object-position:center 20%" />
        {:else if headerArt.kind === 'wash'}
          {@render hiddenCover(m, 'absolute inset-0')}
        {:else}
          <span class="!absolute inset-0 skeloader" aria-hidden="true"></span>
        {/if}
        <div data-part="detail.banner.fade" class="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
        <div data-part="detail.body" class="relative z-10 flex min-h-[56vh] flex-col justify-end gap-3 px-4 pb-8 pt-24">
          {@render seriesTitle(m, 'text-3xl font-black leading-tight text-white drop-shadow')}
          {@render seriesHeader(m, '')}
          {@render headerButtonRow(m, true)}
          {#if m.description}
            <p data-part="detail.synopsis" data-expanded={synopsisOpen.body || undefined} use:clampWatch={{ place: 'body', more: synopsisMore, text: m.description }}
               class="{synopsisOpen.body ? '' : 'line-clamp-4'} text-sm leading-relaxed text-white/85">{stripHtml(m.description)}</p>
            {@render synopsisMoreButton('body')}
          {:else if pending}
            <p data-part="detail.synopsis" class="line-clamp-4 text-sm leading-relaxed text-white/85">{@render placeholderLines(3)}</p>
          {/if}
          <div data-part="detail.meta" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-white/75">
            {#if format(m)}<span>{format(m)}</span>{/if}
            {#each (m.genres ?? []).slice(0, 3) as g (g)}<span class="opacity-40">·</span><span>{g}</span>{/each}
            {#if m.seasonYear || m.startDate?.year}<span class="opacity-40">·</span><span>{m.seasonYear || m.startDate?.year}</span>{/if}
            {#if m.averageScore}<span class="opacity-40">·</span><span>{m.averageScore}%</span>{/if}
          </div>
        </div>
      </div>
      <div data-part="detail.content" class="px-4">
        {#if heroPlay.status === 'error'}
          <p class="mt-3 text-sm text-destructive">{heroPlay.message}</p>
        {/if}
        {#if showRatingRow && media}<div class="mt-4">{@render ratingRow()}</div>{/if}
        {#if belowEpisodes}
          <div class="mt-6">
            {@render episodeList(m)}
          </div>
        {/if}
        <div class="mt-6">
          {@render detailSections(m, true, true)}
        </div>
      </div>
    </div>
  {:else if $isMobile}
    <div data-slot="detail" data-layout={detailTheme.layout} data-variant="phone" data-pending={pending || undefined} style:--cover-rgb={coverRgb} class="relative pb-8">
      <!-- Floating bar. Transparent over the artwork (with a scrim so the chevron survives light
           art), blurred and titled once the artwork has scrolled under it. It carries the status-bar
           inset itself: a fixed element does not inherit main's padding once it locks. -->
      <div data-slot="detail.bar" data-solid={barState.solid || undefined} bind:clientHeight={barHeight}
           class="fixed inset-x-0 top-0 z-30 flex items-center gap-2 px-2 py-2 transition-colors duration-200
                  {barState.solid ? 'border-b border-border bg-background/80 backdrop-blur' : 'text-white'}"
           style="padding-top:max(0.5rem,env(safe-area-inset-top))">
        {#if !barState.solid}
          <div data-part="detail.bar.scrim" class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/55 to-transparent"></div>
        {/if}
        <button data-part="detail.back" data-focusable onclick={heroBack} aria-label="Back"
                class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/15">
          <ChevronLeft size={22} />
        </button>
        {#if detailTheme.bar?.home}{@render barHome()}{/if}
        {#if barState.showTitle && named(m)}
          <span data-part="detail.bar.title" class="min-w-0 flex-1 truncate text-base font-black">{#if barLogo}<img data-part="detail.bar.logo" src={barLogo} alt={title(m)} onerror={() => (failedDetailLogo = barLogo)} class="block h-8 w-auto max-w-full object-contain object-left" />{:else}{title(m)}{/if}</span>
        {/if}
      </div>

      <!-- Artwork band: a bounded strip that ends in a hard cut. Nothing is written on top of it,
           so legibility no longer depends on how busy the banner is. -->
      {#if !detailTheme.bannerHidden}
      <div data-slot="detail.banner" data-art={headerArt.kind} bind:clientHeight={artHeight} style:background-image={headerWash} class="hero-art relative h-[26vh] max-h-72 min-h-44 w-full overflow-hidden">
        {#if headerSrc}
          <img data-part="detail.backdrop" data-art={headerArt.kind} use:headerImage={{ src: headerSrc, onfailed: backdropFailed }} alt="" onload={markArtLoaded}
               class="h-full w-full object-cover transition-opacity duration-500 {artReady(headerSrc) ? 'opacity-100' : 'opacity-0'}"
               style="object-position:center 20%" />
        {:else if headerArt.kind === 'wash'}
          <!-- No banner and no key art: the band is a wash of the cover's colour (its background). A
               YouTube trailer still has blurred pillarbox bars baked into the JPEG, and a blurred or
               stretched cover reads as broken art. -->
          {@render hiddenCover(m, '')}
        {:else}
          <!-- `!absolute`: app.css declares `.skeloader { position: relative }` after the utilities. -->
          <span class="!absolute inset-0 skeloader" aria-hidden="true"></span>
        {/if}
        <div data-part="detail.banner.fade" class="absolute inset-x-0 bottom-0 h-1/6 bg-gradient-to-b from-transparent to-background"></div>
      </div>
      {/if}

      <div data-part="detail.content" class="px-4">
        <!-- `relative z-10`: the artwork band above is positioned, so it paints OVER static
             in-flow content — and this row is pulled up into it. Without a stacking context of its
             own the band covered the top of the poster the moment its image loaded, which read as
             the cover being cropped (and looked fine until then, because the band was transparent). -->
        <div data-part="detail.head" class="relative z-10 {detailTheme.bannerHidden ? 'mt-2' : '-mt-10'} flex gap-4">
          <!-- Covers vary in aspect; forcing them all into one ratio with object-cover crops real
               artwork the user came here to see. Follow the image's own height instead. -->
          <img data-part="detail.poster" use:reliableImage={posterSrc(m)} alt="" onload={markPosterLoaded}
               class="h-auto w-28 shrink-0 self-start rounded-xl object-contain shadow-xl min-[420px]:w-32 {posterWaiting(m) ? 'aspect-[46/65] skeloader' : ''}"
               style:width={detailTheme.posterWidth ? `${Math.min(detailTheme.posterWidth, 160)}px` : undefined} />
          <div class="min-w-0 flex-1 self-end">
            {#if m.title.native || m.title.romaji}
              <div data-part="detail.alt-title" class="truncate text-xs text-muted-foreground">{m.title.native || m.title.romaji}</div>
            {/if}
            {@render seriesTitle(m, 'line-clamp-2 text-xl font-black leading-tight')}
            {@render seriesHeader(m, 'mt-2')}
          </div>
        </div>

        {#if !mobileTabs.infoInOverview}{@render phoneInfo(m)}{/if}

        <!-- Primary CTA, and the full-width list button or Download the theme puts with it. -->
        {@render headerButtonRow(m, false)}

        <!-- Compact action row: 4 icons + overflow. Handlers are the SAME functions the desktop bar uses. -->
        <div data-part="detail.actions" class="relative mt-2 flex items-center gap-2">
          {#if detailTheme.actionsLead}
            <!-- API 4 `detail.actionsLead`: a template taking the row's free width before its buttons. -->
            <div data-part="detail.lead" class="min-w-0 flex-1">
              <ThemeNode node={detailTheme.actionsLead} model={leadModel(m)} />
            </div>
          {/if}
          <button data-part="button" data-variant="secondary" data-action="save" data-state={savedLocally ? 'saved' : undefined} data-focusable onclick={ready(() => { h.tap(); showLocalLists = true })} aria-label="Save to lists"
                  class="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-secondary px-2 text-sm font-bold">
            {#if savedLocally}<BookmarkCheck size={17} class="text-theme" /> Saved{:else}<BookmarkPlus size={17} /> Save{/if}
          </button>
          <button data-part="button" data-variant="icon" data-action="share" data-focusable onclick={ready((full) => { h.tap(); void onShare(full) })} aria-label="Share series"
                  class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
            {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
          </button>
          {#if m.trailer?.id}
            <button data-part="detail.action" data-action="trailer" data-focusable onclick={ready((full) => { if (!full.trailer?.id) return; h.tap(); openTrailerPopup(full.trailer.id, title(full)) })} aria-label="Trailer"
                    class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
              <Clapperboard size={18} />
            </button>
          {/if}
          <button data-part="detail.action" data-action="more" data-focusable onclick={() => { h.tap(); showMore = !showMore }} aria-label="More"
                  aria-haspopup="true" aria-expanded={showMore}
                  class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
            <MoreHorizontal size={18} />
          </button>

          {#if showMore}
            <!-- Full-screen backdrop (below the menu) so a tap anywhere else dismisses it, matching
                 the trailer dialog's dismissal convention. Escape is handled on <svelte:window>. -->
            <button type="button" aria-label="Close menu" onclick={() => (showMore = false)}
                    class="fixed inset-0 z-40 cursor-default"></button>
            <div data-part="detail.menu" class="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-lg border border-border bg-card p-2 shadow-2xl">
              <button data-part="detail.list-button" data-action="list" data-state={effStatus ? 'listed' : undefined} data-focusable onclick={ready(() => { h.tap(); showMore = false; showEditor = true })}
                      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
                <ChevronDown size={15} /> {effStatus ? `Edit ${STATUS_LABEL[effStatus]}` : 'Add to list'}
              </button>
              {#each externalTrackerLinks as tracker (tracker.id)}
                <button data-focusable onclick={ready(() => { h.tap(); showMore = false; openUrl(tracker.url) })}
                        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
                  <ExternalLink size={15} /> {tracker.title}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if heroPlay.status === 'error'}
          <p class="mt-3 text-sm text-destructive">{heroPlay.message}</p>
        {/if}
        {#if showRatingRow && media}<div class="mt-4">{@render ratingRow()}</div>{/if}

        {#if belowEpisodes}
          <div class="mt-6">
            {@render episodeList(m)}
          </div>
        {/if}

        <div class="mt-6">
          {@render detailSections(m, true, false)}
        </div>
      </div>
    </div>
  {:else if overlayDetail}
    <section data-slot="detail" data-layout="overlay" data-variant="desktop" data-pending={pending || undefined} style:--cover-rgb={coverRgb} class="relative isolate min-h-[72vh] w-full overflow-hidden" data-theme-surface="detail-overlay">
      {#if headerSrc}
        <img data-part="detail.backdrop" data-art={headerArt.kind} use:headerImage={{ src: headerSrc, onfailed: backdropFailed }} alt="" onload={markArtLoaded}
             class="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 {artReady(headerSrc) ? 'opacity-100' : 'opacity-0'}"
             style="object-position:center 20%" />
      {:else if headerArt.kind === 'wash'}
        <span class="absolute inset-0" style:background-image={headerWash} aria-hidden="true"></span>
        {@render hiddenCover(m, 'absolute inset-0')}
      {:else}
        <span class="!absolute inset-0 skeloader" aria-hidden="true"></span>
      {/if}
      <div class="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent"></div>
      <div class="absolute inset-y-0 left-0 w-[58%] bg-gradient-to-r from-background/95 via-background/55 to-transparent"></div>
      <div data-part="detail.body" class="relative z-10 flex min-h-[72vh] max-w-3xl flex-col justify-center gap-5 px-8 py-20 sm:px-12">
        {#if m.title.native || m.title.romaji}
          <div data-part="detail.alt-title" class="text-sm text-white/70">{m.title.native || m.title.romaji}</div>
        {/if}
        {@render seriesTitle(m, 'text-5xl font-black leading-[1.02] text-white drop-shadow-md sm:text-6xl')}
        {@render seriesHeader(m, '')}
        <div data-part="detail.actions" class="flex flex-wrap items-center gap-3">
          <button data-part="button" data-variant="primary" data-action="play" data-state={ctaState(m)} data-episode={ctaEp(m)} data-focusable data-nav-id="series-primary-action" data-nav-scroll-top
                  data-nav-down={controllerUi ? 'series-quick-episode' : undefined}
                  onpointerenter={warmPlay}
                  onfocus={warmPlay}
                  use:focusOnMount onclick={pressPlay} aria-busy={playWhenReady || undefined}
                  class="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">
            <Play size={18} />{ctaHasProgress(m) ? `Play · Ep ${ctaEp(m)}` : $offlineMode ? `Play · Ep ${ctaEp(m)}` : 'Play'}
          </button>
          <button data-part="button" data-variant="secondary" data-action="save" data-state={savedLocally ? 'saved' : undefined} data-focusable onclick={ready(() => (showLocalLists = true))} title="Save to lists"
                  class="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25">
            {#if savedLocally}<BookmarkCheck size={20} />{:else}<BookmarkPlus size={20} />{/if}
          </button>
        </div>
        {#if m.studios?.nodes?.[0]}
          {@const studio = m.studios.nodes[0]}
          <p data-part="detail.studio" class="text-sm text-white/80">Studio: <a class="underline-offset-2 hover:underline" href={studio.id ? `/app/studio/${studio.id}` : `/app/search?search=${encodeURIComponent(studio.name)}`}>{studio.name}</a></p>
        {:else if pending}
          <p data-part="detail.studio" class="text-sm text-white/80"><span class="inline-block w-40 rounded align-top skeloader" aria-hidden="true">&nbsp;</span></p>
        {/if}
        {#if m.description}
          <p data-part="detail.synopsis" class="max-w-2xl text-base leading-relaxed text-white/90 line-clamp-6">{stripHtml(m.description)}</p>
        {:else if pending}
          <p data-part="detail.synopsis" class="max-w-2xl text-base leading-relaxed text-white/90 line-clamp-6">{@render placeholderLines(4)}</p>
        {/if}
        <div data-part="detail.meta" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-white/80">
          {#if format(m)}<span>{format(m)}</span>{/if}
          {#each (m.genres ?? []).slice(0, 4) as g (g)}<span class="opacity-40">·</span><span>{g}</span>{/each}
          {#if m.seasonYear || m.startDate?.year}<span class="opacity-40">·</span><span>{m.seasonYear || m.startDate?.year}</span>{/if}
          {#if m.averageScore}<span class="opacity-40">·</span><span>{m.averageScore}%</span>{/if}
        </div>
        <div data-part="detail.meta" class="flex flex-wrap items-center gap-2 text-xs font-bold text-white/75">
          {#if status(m)}<span class="rounded-full border border-white/25 px-2.5 py-1">{status(m)}</span>{/if}
          {#if m.duration}<span>{m.duration}m</span>{/if}
        </div>
        {#if heroPlay.status === 'error'}
          <p class="text-sm text-destructive">{heroPlay.message}</p>
        {/if}
        {#if showRatingRow && media}<div data-part="detail.rating" class="mt-4">{@render ratingRow()}</div>{/if}
      </div>
    </section>
    <div class="relative px-4 pb-16 sm:px-8" data-theme-surface="detail">
      {#if belowEpisodes}
        <div class="mb-6">
          {@render episodeList(m)}
        </div>
      {/if}
      {@render detailSections(m, false, true)}
    </div>
  {:else}
  <!-- Title-less banner backdrop; the info panel below overlaps its lower fade.
       Width-scaled banners sit behind the cover from the top of the page (the artwork
       follows the window width at 5:1) instead of a viewport-height strip with a gap above the cover. -->
  <div data-slot="detail" data-layout={detailTheme.layout} data-variant="desktop" data-pending={pending || undefined} style:--cover-rgb={coverRgb} class="relative">
  {#if !detailTheme.bannerHidden}
  <div class={detailTheme.bannerScale === 'banner' ? 'pointer-events-none absolute inset-x-0 top-0 z-0 w-full' : ''}>
  <Hero medias={[m]} showOverlay={false} artwork={headerArt} onartworkfailed={backdropFailed} />
  </div>
  {/if}
  <div class="relative z-10 px-4 pb-16 sm:px-8 {detailTheme.bannerHidden ? 'pt-8' : detailTheme.bannerScale === 'banner' ? 'pt-[7.5rem]' : ''}" style:margin-top={detailTheme.bannerHidden || detailTheme.bannerScale === 'banner' ? undefined : `-${bannerOverlap}vh`} data-theme-surface="detail">
    {#if heroPlay.status === 'error'}
      <p class="mb-3 text-sm text-destructive">{heroPlay.message}</p>
    {/if}

    <!-- The facts and the action bar, shared by the header panel and the poster column. -->
    {#snippet factsBlock()}
        {#if factsStyle !== 'template'}
          <FactList media={m} variant={factsStyle} className="mb-3" progress={progressFact(m)} {controllerUi} keys={detailTheme.factsKeys} labels={detailTheme.factsLabels} format={detailTheme.factsFormat} {pending} />
        {:else if detailTheme.facts}
          <div data-part="detail.facts" class="mb-3">
            <ThemeNode node={detailTheme.facts} model={factsModel(m)} />
          </div>
        {:else}
        <!-- One scannable facts line replaces two rows of competing pills. Genres remain useful
             discovery links for pointer users, but are deliberately not D-pad stops in Game mode:
             Down from the primary action is a content path, not a tour through metadata. -->
        <div data-part="detail.meta" class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted-foreground">
          {#if unnamed(m)}<span class="my-0.5 h-3 w-72 rounded skeloader" aria-hidden="true"></span>{:else}
          <span class="text-foreground">{effProgress}/{epsTotal(m) || '?'} episodes</span>
          {#if format(m)}<span class="opacity-40">·</span><span>{format(m)}</span>{/if}
          {#if status(m)}<span class="opacity-40">·</span><span>{status(m)}</span>{/if}
          {#if season(m)}
            <span class="opacity-40">·</span>
            <a data-focusable={controllerUi ? undefined : ''} tabindex={controllerUi ? -1 : undefined}
               href={seasonBrowseHref(m)} class="transition-colors hover:text-foreground hover:underline">{season(m)}</a>
          {/if}
          {#if m.averageScore}<span class="opacity-40">·</span><span class="rounded px-1.5 py-0.5 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>{/if}
          {#each (m.genres ?? []).slice(0, controllerUi ? 3 : 4) as g (g)}
            <span class="opacity-40">·</span>
            <a data-part="chip" data-focusable={controllerUi ? undefined : ''} tabindex={controllerUi ? -1 : undefined}
               href={`/app/search?genre=${encodeURIComponent(g)}`}
               class="transition-colors hover:text-foreground hover:underline">{g}</a>
          {/each}
          {#if (m.genres?.length ?? 0) > (controllerUi ? 3 : 4)}
            <span class="font-medium opacity-60">+{(m.genres?.length ?? 0) - (controllerUi ? 3 : 4)}</span>
          {/if}
          {/if}
        </div>
        {/if}
    {/snippet}
    {#snippet actionsBlock()}
        <!-- Action bar -->
        <div data-part="detail.actions" class="flex flex-wrap items-center gap-2">
          <button data-part="button" data-variant="primary" data-action="play" data-state={ctaState(m)} data-episode={ctaEp(m)} data-focusable data-nav-id="series-primary-action" data-nav-scroll-top
                  data-nav-down={controllerUi ? 'series-quick-episode' : undefined}
                  onpointerenter={warmPlay}
                  onfocus={warmPlay}
                  use:focusOnMount onclick={pressPlay} aria-busy={playWhenReady || undefined}
                  class="inline-flex items-center gap-2 rounded-md bg-primary font-bold text-primary-foreground {detailTheme.cta === 'large' ? 'min-w-56 px-6 py-3 text-base' : 'px-4 py-2'}">
            <Play size={detailTheme.cta === 'large' ? 18 : 16} />{detailTheme.cta === 'large' ? (effStatus === 'COMPLETED' ? 'Rewatch Now' : ctaHasProgress(m) ? 'Continue Now' : 'Watch Now') : (ctaHasProgress(m) ? `Continue · Ep ${ctaEp(m)}` : $offlineMode ? `Play · Ep ${ctaEp(m)}` : 'Play')}
          </button>

          <button data-part="button" data-variant="secondary" data-action="save" data-state={savedLocally ? 'saved' : undefined} data-focusable onclick={ready(() => (showLocalLists = true))} title="Save to lists"
                  class="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 font-bold transition-colors hover:bg-accent">
            {#if savedLocally}<BookmarkCheck size={18} class="text-theme" /> Saved{:else}<BookmarkPlus size={18} /> Save{/if}
          </button>

          {#if detailTheme.listButton !== 'hidden'}
          <button data-part="detail.list-button" data-action="list" data-state={effStatus ? 'listed' : undefined} bind:this={editorAnchor} data-focusable onclick={ready(() => (showEditor = true))} title="Edit list status"
                  aria-haspopup="dialog" aria-expanded={showEditor}
                  class="inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-2 font-bold transition-colors hover:bg-accent">
            {#if effStatus}
              <span class="size-2.5 rounded-full" style="background:{STATUS_COLOR[effStatus]}"></span>{STATUS_LABEL[effStatus]}
            {:else}
              <BookmarkPlus size={18} /> Add to List
            {/if}
            <ChevronDown size={16} class="opacity-60" />
          </button>
          {/if}

          <button data-part="button" data-variant="icon" data-action="share" data-focusable onclick={ready((full) => void onShare(full))} title="Copy AniList link"
                  class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
            {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
          </button>

          {#if m.trailer?.id && !posterColumn}
            <button data-part="detail.action" data-action="trailer" data-focusable onclick={ready((full) => { if (full.trailer?.id) openTrailerPopup(full.trailer.id, title(full)) })} title="Watch trailer"
                    class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
              <Clapperboard size={18} />
            </button>
          {/if}

          {#each externalTrackerLinks as tracker (tracker.id)}
            <button data-focusable onclick={ready(() => openUrl(tracker.url))} title={tracker.title} aria-label={tracker.title}
                    class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
              <TrackerProviderBadge provider={tracker.id} compact />
            </button>
          {/each}
        </div>
    {/snippet}

    {#snippet seriesInfo()}
    <!-- Hero info panel: cover + title/badges/description + action bar. -->
    <!-- The banner is the dominant artwork; the portrait is an identity anchor, not the ruler for
         the whole header. At 13rem it left a poster-height void beneath the much shorter info
         column, delaying Episodes by roughly a full D-pad viewport. An 11rem cover retains a clear
         visual identity while keeping both columns close enough in height for Episodes to follow. -->
    <div class="mb-4 flex flex-col gap-5 md:flex-row {detailTheme.coverAlign === 'end' ? 'md:items-end' : detailTheme.coverAlign === 'start' ? 'md:items-start' : ''}">
      <img data-part="detail.poster" use:reliableImage={posterSrc(m)} alt="" onload={markPosterLoaded} class="h-auto w-44 shrink-0 rounded-lg object-contain shadow-lg {detailTheme.coverAlign === 'end' ? 'self-end' : 'self-start'} {posterWaiting(m) ? 'aspect-[46/65] skeloader' : ''}" style:width={detailTheme.posterWidth ? `${detailTheme.posterWidth}px` : undefined} />

      <div class="min-w-0 flex-1 {detailTheme.bannerScale === 'banner' ? 'md:pt-12' : ''}">
        {#if m.title.native || m.title.romaji}
          <div data-part="detail.alt-title" class="text-sm text-muted-foreground">{m.title.native || m.title.romaji}</div>
        {/if}
        {@render seriesTitle(m, 'mb-2 text-3xl font-black')}
        {@render seriesHeader(m, 'mb-3')}

        {@render factsBlock()}
        {#if countdown !== 'none'}<AiringCountdown media={m} variant={countdown} className="mb-3" />{/if}

        <!-- Where a flip order is the round gutter button there is no toolbar line for release timing
             (toolbar-plan.ts); everywhere else the episode controls show it. -->
        {#if flipGutter}
          <div data-part="detail.airing.wrap" class="mb-3 flex flex-wrap items-center gap-2 empty:mb-0">
            {#if !pending || named(m)}<AiringStatus media={m} />{/if}
          </div>
        {/if}

        {#if m.description && !detailTheme.actionsFirst && synopsisAt !== 'overview'}
          <p data-part="detail.synopsis" class="mb-3 {controllerUi ? 'line-clamp-2' : 'line-clamp-3'} max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {:else if pending && !detailTheme.actionsFirst && synopsisAt !== 'overview'}
          <p data-part="detail.synopsis" class="mb-3 {controllerUi ? 'line-clamp-2' : 'line-clamp-3'} max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{@render placeholderLines(controllerUi ? 2 : 3)}</p>
        {/if}

        {@render actionsBlock()}
        {#if showRatingRow && media}<div class="mt-4">{@render ratingRow()}</div>{/if}
      </div>
    </div>
    {#if m.description && detailTheme.actionsFirst && synopsisAt !== 'overview'}
      <p data-part="detail.synopsis" class="mb-4 {controllerUi ? 'line-clamp-4' : 'line-clamp-6'} max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{stripHtml(m.description)}</p>
    {:else if pending && detailTheme.actionsFirst && synopsisAt !== 'overview'}
      <p data-part="detail.synopsis" class="mb-4 {controllerUi ? 'line-clamp-4' : 'line-clamp-6'} max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{@render placeholderLines(3)}</p>
    {/if}
    {/snippet}

    {#snippet desktopSecondary()}
    {@render detailSections(m, false, false)}
    {/snippet}

    {#if posterColumn && !sideEpisodes}
      <!-- detail.column "poster": the poster heads a left column with a labelled trailer button, the
           countdown and the facts under it; the title, actions, synopsis and sections run beside it. -->
      <div class="flex flex-col gap-5 md:grid md:items-start md:gap-4" style:grid-template-columns={`${detailTheme.posterWidth ?? 248}px minmax(0, 1fr)`}>
        <aside data-slot="detail.column" class="flex min-w-0 flex-col gap-3">
          <img data-part="detail.poster" use:reliableImage={posterSrc(m)} alt="" onload={markPosterLoaded} class="h-auto w-full rounded-lg object-cover shadow-lg {posterWaiting(m) ? 'aspect-[46/65] skeloader' : ''}" />
          {#if m.trailer?.id}
            <button data-part="detail.trailer" data-action="trailer" data-focusable onclick={ready((full) => { if (full.trailer?.id) openTrailerPopup(full.trailer.id, title(full)) })}
                    class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
              <Play size={16} />Watch Trailer
            </button>
          {/if}
          {#if countdown !== 'none'}<AiringCountdown media={m} variant={countdown} />{/if}
          {@render factsBlock()}
        </aside>
        <div class="min-w-0">
          {#if m.title.native || m.title.romaji}
            <div data-part="detail.alt-title" class="text-sm text-muted-foreground">{m.title.native || m.title.romaji}</div>
          {/if}
          {@render seriesTitle(m, 'mb-2 text-3xl font-black')}
          {@render seriesHeader(m, 'mb-3')}
          {#if flipGutter}<div data-part="detail.airing.wrap" class="mb-3 flex flex-wrap items-center gap-2 empty:mb-0">{#if !pending || named(m)}<AiringStatus media={m} />{/if}</div>{/if}
          {#if m.description && !detailTheme.actionsFirst && synopsisAt !== 'overview'}
            <p data-part="detail.synopsis" class="mb-3 line-clamp-3 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
          {:else if pending && !detailTheme.actionsFirst && synopsisAt !== 'overview'}
            <p data-part="detail.synopsis" class="mb-3 line-clamp-3 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{@render placeholderLines(3)}</p>
          {/if}
          {@render actionsBlock()}
          {#if showRatingRow && media}<div class="mt-4">{@render ratingRow()}</div>{/if}
          {#if m.description && detailTheme.actionsFirst && synopsisAt !== 'overview'}
            <p data-part="detail.synopsis" class="mt-4 line-clamp-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{stripHtml(m.description)}</p>
          {:else if pending && detailTheme.actionsFirst && synopsisAt !== 'overview'}
            <p data-part="detail.synopsis" class="mt-4 line-clamp-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{@render placeholderLines(3)}</p>
          {/if}
          {#if belowEpisodes}<div class="mt-6">{@render episodeList(m)}</div>{/if}
          <div class="mt-6">{@render desktopSecondary()}</div>
        </div>
      </div>
    {:else if sideEpisodes}
      <div class="flex flex-col gap-6 min-[960px]:grid min-[960px]:grid-cols-[minmax(0,1fr)_minmax(22rem,40%)] min-[960px]:items-start min-[960px]:gap-8">
        <div class="min-w-0">
          {@render seriesInfo()}
          {@render desktopSecondary()}
        </div>
        <aside class="relative min-w-0 min-[960px]:sticky min-[960px]:top-10">
          {@render episodeList(m)}
        </aside>
      </div>
    {:else}
      {@render seriesInfo()}
      {#if belowEpisodes}
        <div class="mb-6">
          {@render episodeList(m)}
        </div>
      {/if}
      {@render desktopSecondary()}
    {/if}
  </div>
  </div>
  {/if}

  {#if showEditor && media}
    <ListEditor
      media={media}
      initStatus={effStatus}
      initProgress={effProgress}
      initScore0to100={effScore100}
      total={epsTotal(media) || 0}
      {hasEntry}
      {canRemove}
      anchor={editorAnchor}
      onclose={() => (showEditor = false)}
      onsaved={(patch) => { listOpt = { ...listEntry.edit, ...patch }; watchedBefore = watched }}
    />
  {/if}
  {#if showLocalLists && media}<LocalListPicker media={media} onclose={() => (showLocalLists = false)} />{/if}
{:else if $offlineMode}
  <div class="grid min-h-[50vh] place-items-center p-8 text-center">
    <div class="max-w-sm text-muted-foreground">
      <p class="mb-4">This title isn't available offline. Download episodes while connected to watch them here.</p>
      <a href="/app/downloads" data-focusable class="rounded-md bg-secondary px-4 py-2 text-sm font-bold text-foreground">Go to Downloads</a>
    </div>
  </div>
{:else}
  {#if $isMobile}{@render failureBar()}{/if}
  <div class="p-8 text-muted-foreground {$isMobile ? 'pt-[calc(4rem+env(safe-area-inset-top))]' : 'pt-[max(2rem,env(safe-area-inset-top))]'}">Not found.</div>
{/if}

<!-- The phone bar on a page that failed to load or found nothing: a theme that covers the bottom
     navigation (`detail.nav: "hidden"`) would otherwise leave no way back. -->
{#snippet failureBar()}
  <div data-slot="detail.bar" data-solid class="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border bg-background/80 px-2 py-2 backdrop-blur"
       style="padding-top:max(0.5rem,env(safe-area-inset-top))">
    <button data-part="detail.back" data-focusable onclick={heroBack} aria-label="Back"
            class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/15">
      <ChevronLeft size={22} />
    </button>
    {#if detailTheme.bar?.home}{@render barHome()}{/if}
  </div>
{/snippet}

<!-- API 4 `detail.bar.home`: a Home link after Back in the phone series bar. -->
{#snippet barHome()}
  <a data-part="detail.home" data-focusable href="/app/home" aria-label="Home"
     class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors active:bg-white/15">
    <House size={20} />
  </a>
{/snippet}

<!-- Only ever rendered with the full record (`media`), never the card's. -->
{#snippet ratingRow()}
  <ScoreScale value={effScore10} onpick={ready((full, n: number) => rate(full, n))} hint={ratingHint} />
{/snippet}

<!-- The episode list. While the record loads, neutral placeholders hold its place: the card's record
     lacks the schedule and the aliases the list and its source prefetch need. -->
{#snippet episodeList(m: Media)}
  {#if pending}
    <div data-slot="detail.episodes" class="relative" aria-hidden="true">
      <div class="grid grid-cols-1 gap-3">
        {#each Array(3) as _, index (index)}<div class="h-24 rounded-lg skeloader"></div>{/each}
      </div>
    </div>
  {:else}
    <EpisodeList media={m} offline={$offlineMode} />
  {/if}
{/snippet}

<!-- Lines standing in for text the card's record does not carry, inside the part the text fills. -->
{#snippet placeholderLines(count: number)}
  {#each Array(count) as _, index (index)}<span class="my-1.5 block h-3.5 rounded skeloader {index === count - 1 ? 'w-2/3' : 'w-full'}" aria-hidden="true"></span>{/each}
{/snippet}

<!-- The phone header's buttons, in the theme's order (API 4 `detail.buttons`): Play (the overlay body
     draws it as its pill), the full-width list button and Download, inside `detail.buttons`. Without
     the key they stay where they always were, straight in the page's column (or the overlay body), so
     stylesheets written for that keep working. -->
{#snippet headerButtonRow(m: Media, overlay: boolean)}
  {#if !detailTheme.buttons}
    {@render headerButtonList(m, overlay)}
  {:else if shownButtons.length}
    <div data-part="detail.buttons" class={overlay ? 'flex flex-col gap-2' : undefined}>
      {@render headerButtonList(m, overlay)}
    </div>
  {/if}
{/snippet}

{#snippet headerButtonList(m: Media, overlay: boolean)}
  {#each shownButtons as button (button)}
    {#if button === 'play'}
      <button data-part="button" data-variant="primary" data-action="play" data-state={ctaState(m)} data-episode={ctaEp(m)} data-focusable use:focusOnMount
              onpointerenter={warmPlay}
              onfocus={warmPlay}
              onclick={pressPlay} aria-busy={playWhenReady || undefined}
              class={overlay
                ? 'mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground'
                : 'mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-bold text-primary-foreground'}>
        <Play size={18} />{ctaHasProgress(m) ? `${overlay ? 'Play' : 'Continue'} · Ep ${ctaEp(m)}` : $offlineMode ? `Play · Ep ${ctaEp(m)}` : 'Play'}
      </button>
    {:else if button === 'list'}
      <button data-part="detail.list-button" data-variant="full" data-action="list" data-state={effStatus ? 'listed' : undefined} data-focusable onclick={ready(() => { h.tap(); showEditor = true })}
              class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-theme py-2.5 text-sm font-black uppercase tracking-wide text-theme">
        {effStatus ? STATUS_LABEL[effStatus] : 'Add to list'}
      </button>
    {:else}
      <button data-part="button" data-variant="secondary" data-action="download" data-focusable onclick={ready((full) => downloadCta(full))}
              class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-secondary py-2.5 text-sm font-bold">
        <Download size={17} />Download E{ctaEp(m)}
      </button>
    {/if}
  {/each}
{/snippet}

<!-- API 4 `detail.synopsis`: the "more" control after a phone synopsis, only while the stylesheet's
     clamp cuts the text or the text is open. -->
{#snippet synopsisMoreButton(place: SynopsisPlace)}
  {#if synopsisMore !== 'none' && (synopsisClamped[place] || synopsisOpen[place])}
    <button data-part="detail.synopsis.more" type="button" data-focusable onclick={() => pressSynopsisMore(place)}
            aria-expanded={opensOverview(place) ? undefined : synopsisOpen[place]}
            class="mt-1 text-sm font-bold text-theme">{synopsisOpen[place] ? 'Show less' : synopsisLabel}</button>
  {/if}
{/snippet}

<!-- Overview's whole synopsis on phones: where `more: "tab"` leads. A stylesheet may clamp it too. -->
{#snippet overviewSynopsisText(description: string)}
  <p data-part="detail.synopsis" bind:this={overviewSynopsis} data-expanded={synopsisOpen.overview || undefined}
     use:clampWatch={{ place: 'overview', more: synopsisMore, text: description }}
     class="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{stripHtml(description)}</p>
  {@render synopsisMoreButton('overview')}
{/snippet}

<!-- The phone Information grid: inside Overview under its own heading, or a section of its own (API 4
     `information`) named by the section. Its facts follow `detail.infoKeys`, else izumi's own. -->
{#snippet informationBlock(m: Media, titled: boolean)}
  <section data-part="detail.info" class={titled ? undefined : 'mt-3'}>
    {#if titled}<h2 data-part="detail.block-title" class="mb-2 text-base font-black">Information</h2>{/if}
    <dl class="grid grid-cols-2 gap-2 text-sm">
      {#each infoFacts(m) as fact (fact.key)}
        <div data-part="fact" data-key={fact.key} class="{fact.links ? 'col-span-2 ' : ''}rounded-xl bg-secondary/40 p-3">
          <dt data-part="fact.label" class="text-xs font-bold uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="mt-1 font-bold">{@render infoValue(fact)}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/snippet}

{#snippet infoValue(fact: MediaFact)}
  {#if fact.pending}<span class="inline-block h-3.5 w-16 max-w-full rounded align-middle skeloader" aria-hidden="true"></span>{:else if fact.links}{#each fact.links as link, i (link.href)}{i ? ' · ' : ''}<a class="underline-offset-2 active:opacity-70" href={link.href}>{link.text}</a>{/each}{:else if fact.href}<a href={fact.href} class="underline-offset-2 active:opacity-70">{fact.value}</a>{:else}{fact.value}{/if}{#if fact.suffix}<span data-part="fact.suffix">{fact.suffix}</span>{/if}
{/snippet}

<!-- The cover behind a page with neither a banner nor key art. izumi's own look hides it and shows a
     wash of the cover's colour; a theme can show it instead (`[data-part="detail.backdrop"][data-art="cover"]`). -->
{#snippet hiddenCover(m: Media, place: string)}
  {#if cover(m)}
    <img data-part="detail.backdrop" data-art="cover" src={cover(m)} alt="" aria-hidden="true"
         class="{place} h-full w-full object-cover opacity-0" style="object-position:center 30%" />
  {/if}
{/snippet}

<!-- A theme's template under the title (API 3 `detail.header`), the same on every layout. -->
{#snippet seriesHeader(m: Media, className: string)}
  {#if detailTheme.header}
    <div data-part="detail.header" class={className}>
      <ThemeNode node={detailTheme.header} model={mediaDisplayModel(m, { reviews: m.popularity ? String(m.popularity) : undefined, episodesWatched, ...detailExtras })} />
    </div>
  {/if}
{/snippet}

<!-- The series title: the title logo when the theme asks for it (API 3 `detail.title: "logo"`) and
     the title has one, else the text. While the logo may still arrive the text is transparent, not
     hidden, so screen readers still read the title. A page still loading without a known title
     shows a placeholder line inside the heading. -->
{#snippet seriesTitle(m: Media, className: string)}
  {#if detailLogo}
    <h1 data-part="detail.title" aria-label={named(m) ? title(m) : undefined} class={className}>
      <img data-part="detail.logo" src={detailLogo} alt="" onerror={() => (failedDetailLogo = detailLogo)}
           class="block max-h-44 w-auto max-w-[min(26rem,85%)] object-contain object-left-bottom" />
    </h1>
  {:else if unnamed(m)}
    <h1 data-part="detail.title" class={className}><span class="inline-block w-3/5 min-w-32 max-w-full rounded-md align-top skeloader" aria-hidden="true">&nbsp;</span><span class="sr-only">Loading</span></h1>
  {:else}
    <h1 data-part="detail.title" class="{className} {detailTheme.title === 'logo' && !detailExtrasSettled ? 'opacity-0' : ''}">{title(m)}</h1>
  {/if}
{/snippet}

<!-- The phone facts: the facts line (or FactList, or the theme's facts template), the countdown, the
     genre rail, release timing and the synopsis. Above the tabs by default; inside Overview with
     `detail.sections.info: "overview"`. -->
{#snippet phoneInfo(m: Media)}
  {#if factsStyle === 'template' && detailTheme.facts}
    <!-- A theme's facts template stands in for the facts line and byline, as a table, cards or chips do. -->
    <div data-part="detail.facts" class="mt-3">
      <ThemeNode node={detailTheme.facts} model={factsModel(m)} />
    </div>
  {:else if factsStyle === 'template'}
  <!-- One line of facts instead of seven chips: on a phone the chips wrapped into three
       rows and read as a wall of pills rather than a summary. Facts sit directly under the
       title — identity first, schedule after. -->
  <div data-part="detail.meta" class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted-foreground">
    {#if unnamed(m)}<span class="my-0.5 h-3 w-56 rounded skeloader" aria-hidden="true"></span>{:else}
    {#if m.averageScore}
      <span class="rounded-full px-1.5 py-0.5 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>
    {/if}
    {#if format(m)}<span>{format(m)}</span><span class="opacity-40">·</span>{/if}
    <span>{effProgress}/{epsTotal(m) || '?'} eps</span>
    {#if m.duration}<span class="opacity-40">·</span><span>{m.duration} min</span>{/if}
    {#if season(m)}<span class="opacity-40">·</span><a href={seasonBrowseHref(m)} class="underline-offset-2 active:opacity-70">{season(m)}</a>{/if}
    {#if status(m)}<span class="opacity-40">·</span><span>{status(m)}</span>{/if}
    {/if}
  </div>

  <!-- Give the title useful provenance without turning the summary into another pill wall.
       Mature mobile anime clients surface studio/source/popularity before asking the user to
       hunt through a final tab; this stays a single quiet wrapping line. -->
  <div data-part="detail.byline" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/65">
    {#if m.studios?.nodes?.[0]}
      {@const studio = m.studios.nodes[0]}
      <a href={studio.id ? `/app/studio/${studio.id}` : `/app/search?search=${encodeURIComponent(studio.name)}`}
         class="font-bold text-foreground/85 underline-offset-2 active:opacity-70">{studio.name}</a>
    {/if}
    {#if m.source}<span class="opacity-35">·</span><span>From {prettyEnum(m.source)}</span>{/if}
    {#if m.popularity}<span class="opacity-35">·</span><span>{compactNumber.format(m.popularity)} members</span>{/if}
    {#if pending && !m.studios?.nodes?.[0] && !m.source && !m.popularity}<span class="my-0.5 h-3 w-44 rounded skeloader" aria-hidden="true"></span>{/if}
  </div>
  {:else}
    <FactList media={m} variant={factsStyle} progress={progressFact(m)} {controllerUi} genres={false} keys={detailTheme.factsKeys} labels={detailTheme.factsLabels} format={detailTheme.factsFormat} {pending} />
  {/if}
  <!-- Only formats `nextAiringEpisode`, which the card's record carries too. -->
  {#if countdown !== 'none'}<AiringCountdown media={m} variant={countdown} />{/if}

  {#if m.genres?.length}
    <!-- One horizontal rail preserves vertical space while making genre identity visible at a
         glance. It deliberately scrolls instead of wrapping into a tall block above Play. -->
    <div data-part="detail.genres" class="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Genres">
      {#each m.genres as genre (genre)}
        <a data-part="chip" href={`/app/search?genre=${encodeURIComponent(genre)}`}
           class="shrink-0 rounded-full border border-border/80 bg-secondary/55 px-3 py-1.5 text-xs font-bold text-foreground/85 active:bg-accent">{genre}</a>
      {/each}
    </div>
  {/if}

  <!-- Phones have no room for release timing in their episode controls. Keep one quiet
       grouped summary under the facts; desktop anchors it to the episode toolbar instead. The
       lookup needs only the id and the titles, so it starts on the card's record; a placeholder has
       no titles to match. -->
  <div data-part="detail.airing.wrap" class="mt-3 flex flex-wrap items-center gap-2 empty:mt-0">
    {#if !pending || named(m)}<AiringStatus media={m} />{/if}
  </div>

  {#if m.description}
    <button data-part="detail.synopsis" type="button" onclick={() => tapSynopsis('info')} data-expanded={synopsisOpen.info || undefined}
            use:clampWatch={{ place: 'info', more: synopsisMore, text: m.description }}
            class="mt-3 w-full text-left text-sm text-muted-foreground {synopsisOpen.info ? 'block' : 'line-clamp-3'}">
      {stripHtml(m.description)}
    </button>
    {@render synopsisMoreButton('info')}
  {:else if pending}
    <button data-part="detail.synopsis" type="button" tabindex="-1" aria-hidden="true"
            class="mt-3 w-full text-left text-sm text-muted-foreground line-clamp-3">{@render placeholderLines(3)}</button>
  {/if}
{/snippet}

<!-- A section's place while the record loads: the card's record has no relations, cast or
     recommendations, so nothing may claim there are none. -->
{#snippet sectionPlaceholder(phone: boolean)}
  <div class="{phone ? 'mt-3' : ''} space-y-2" aria-hidden="true">
    {#each Array(3) as _, index (index)}<div class="h-4 rounded skeloader {index === 2 ? 'w-1/2' : 'w-full'}"></div>{/each}
  </div>
{/snippet}

<!-- The page's sections (API 3 `detail.sections`): a tab strip over the active section, or every
     section stacked under its own title. Sections without a tab follow Overview's own content.
     Overlay pages keep their shorter Overview (the synopsis). -->
{#snippet detailSections(m: Media, phone: boolean, overlay: boolean)}
  {@const view = phone ? mobileTabs : desktopTabs}
  {@const current = shownTab(view)}
  {#if view.mode === 'stack'}
    {#each [...view.tabs, ...view.folded] as id (id)}
      <section data-slot="detail.section" data-section={id} class="mt-8 first:mt-0">
        <h2 data-part="detail.section-title" data-season-label={id === 'episodes' ? seasonLabel : undefined} class="mb-3 text-lg font-black">{view.labels[id]}</h2>
        {@render sectionBody(m, id, phone, overlay)}
      </section>
    {/each}
  {:else}
    {#if phone}
      <Tabs tabs={view.tabs} labels={view.labels} bind:active={() => current, (tab) => (pickedTab = tab)} variant={detailTheme.tabs} page />
    {:else}
      <Tabs tabs={view.tabs} labels={view.labels} bind:active={() => current, (tab) => (pickedTab = tab)} variant={detailTheme.tabs === 'bottom' ? 'underline' : detailTheme.tabs} page />
    {/if}
    {@render sectionBody(m, current, phone, overlay)}
    {#if current === 'overview'}
      {#each view.folded as id (id)}
        <section data-slot="detail.section" data-section={id} class="mt-8">
          <h2 data-part="detail.section-title" data-season-label={id === 'episodes' ? seasonLabel : undefined} class="mb-3 text-lg font-black">{view.labels[id]}</h2>
          {@render sectionBody(m, id, phone, overlay)}
        </section>
      {/each}
    {/if}
  {/if}
{/snippet}

{#snippet sectionBody(m: Media, id: DetailSection, phone: boolean, overlay: boolean)}
  {#if id === 'episodes'}
    {@render episodeList(m)}
  {:else if id === 'overview'}
    {#if phone && overlay}
      <div data-part="detail.overview" class="mt-4 space-y-5">
        {#if m.description}
          <section>
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Synopsis</h2>
            {@render overviewSynopsisText(m.description)}
          </section>
        {:else if pending}
          <section>
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Synopsis</h2>
            <p data-part="detail.synopsis" class="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{@render placeholderLines(3)}</p>
          </section>
        {/if}
      </div>
    {:else if phone}
      <div data-part="detail.overview" class="mt-4 space-y-5">
        {#if mobileTabs.infoInOverview}<div>{@render phoneInfo(m)}</div>{/if}
        {#if m.description && !mobileTabs.infoInOverview}
          <section>
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Synopsis</h2>
            {@render overviewSynopsisText(m.description)}
          </section>
        {:else if pending && !mobileTabs.infoInOverview}
          <section>
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Synopsis</h2>
            <p data-part="detail.synopsis" class="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{@render placeholderLines(3)}</p>
          </section>
        {/if}

        {#if mobileTabs.information === 'overview'}{@render informationBlock(m, true)}{/if}

        <!-- The card's record carries no tags and often no alternative titles: while the page loads,
             placeholders hold those blocks' places rather than leaving them out. -->
        {#if m.tags?.length}
          <section data-part="detail.tags">
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Themes</h2>
            <MediaTagList tags={m.tags} limit={10} sortByRank />
          </section>
        {:else if pending && m.tags === undefined}
          <section data-part="detail.tags" aria-hidden="true">
            <h2 data-part="detail.block-title" class="mb-2 text-base font-black">Themes</h2>
            <div class="flex flex-wrap gap-2">{#each [20, 24, 16, 22] as width, index (index)}<span data-part="chip" class="h-7 rounded-full skeloader" style:width="{width * 0.25}rem"></span>{/each}</div>
          </section>
        {/if}

        {#if m.synonyms?.length}
          <section data-part="detail.synonyms"><h2 data-part="detail.block-title" class="mb-1 text-base font-black">Alternative titles</h2><p class="text-sm leading-relaxed text-muted-foreground">{#each m.synonyms as synonym, index (index)}<span data-part="chip" class={index ? "before:content-['_·_']" : undefined}>{synonym}</span>{/each}</p></section>
        {:else if pending && m.synonyms === undefined}
          <section data-part="detail.synonyms" aria-hidden="true"><h2 data-part="detail.block-title" class="mb-1 text-base font-black">Alternative titles</h2><p class="text-sm leading-relaxed text-muted-foreground">{@render placeholderLines(1)}</p></section>
        {/if}
      </div>
    {:else if overlay}
      <div class="max-w-3xl space-y-4">
        {#if m.description}
          <p data-part="detail.synopsis" class="whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}
      </div>
    {:else}
      <div class="max-w-3xl space-y-4">
        {#if m.description && synopsisAt !== 'info'}
          <p data-part="detail.synopsis" class="whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}
        <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {#if m.studios?.nodes?.length}
            <div data-part="fact" data-key="studio"><dt data-part="fact.label" class="font-bold">Studios</dt><dd data-part="fact.value" class="text-muted-foreground">{#each m.studios.nodes as studio, i (studio.id ?? studio.name)}{i ? ', ' : ''}<a data-focusable class="underline-offset-2 hover:underline" href={studio.id ? `/app/studio/${studio.id}` : `/app/search?search=${encodeURIComponent(studio.name)}`}>{studio.name}</a>{/each}</dd></div>
          {/if}
          {#if fmtDate(m.startDate)}
            <div data-part="fact" data-key="aired"><dt data-part="fact.label" class="font-bold">Start Date</dt><dd data-part="fact.value" class="text-muted-foreground">{fmtDate(m.startDate)}</dd></div>
          {/if}
          {#if m.synonyms?.length}
            <div data-part="fact" data-key="synonyms" class="sm:col-span-2"><dt data-part="fact.label" class="font-bold">Synonyms</dt><dd data-part="fact.value" class="text-muted-foreground">{m.synonyms.join(' · ')}</dd></div>
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
  {:else if id === 'information'}
    <!-- Its own section (API 4, phones): the section's title or tab names it. Drawn from the card's
         record while loading, with placeholders for what it cannot fill. -->
    {@render informationBlock(m, false)}
  {:else if pending}
    {@render sectionPlaceholder(phone)}
  {:else if id === 'relations'}
    {#if phone}
      {#if m.relations?.edges?.length}
        <div data-slot="detail.relations" class="mt-3 grid grid-cols-2 gap-4">
          {#each m.relations.edges as e (e.node.id)}
            <div data-part="relation" data-relation={e.relationType.toLowerCase()} class="min-w-0">
              <div data-part="relation.type" class="mb-1 truncate text-[0.65rem] uppercase text-muted-foreground">{e.relationType.replaceAll('_', ' ').toLowerCase()}</div>
              <SmallCard media={e.node} fill />
            </div>
          {/each}
        </div>
      {:else}<p class="mt-3 text-muted-foreground">No related titles.</p>{/if}
    {:else if m.relations?.edges?.length}
      <div data-slot="detail.relations" class="flex flex-wrap {$themePresentation ? 'gap-x-6 gap-y-8' : 'gap-4'}">
        {#each m.relations.edges as e (e.node.id)}
          <div data-part="relation" data-relation={e.relationType.toLowerCase()} class={$themePresentation ? 'shrink-0' : 'w-[152px]'}>
            <div data-part="relation.type" class="{$themePresentation ? 'mb-1.5' : 'mb-1'} text-[0.65rem] uppercase text-muted-foreground">{e.relationType.replaceAll('_', ' ').toLowerCase()}</div>
            <SmallCard media={e.node} />
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-muted-foreground">No related titles.</p>
    {/if}
  {:else if id === 'characters'}
    {#if phone}<div class="mt-3"><RichMetadata media={m} view="people" /></div>{:else}<RichMetadata media={m} view="people" />{/if}
  {:else}
    {#if phone}<div class="mt-3"><RichMetadata media={m} view="recommendations" /></div>{:else}<RichMetadata media={m} view="recommendations" />{/if}
  {/if}
{/snippet}
