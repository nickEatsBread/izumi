<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import type { Media } from '$lib/anilist/types'
  import { cover, mediaHref, title } from '$lib/anilist/media'
  import { detailLink } from '$lib/anilist/detail-hint'
  import { parseCatalogDescription } from '$lib/catalog/description'
  import { discoveryFacts, discoveryTrailerId, discoveryWindow, DISCOVERY_PAGE_SIZE } from '$lib/recommendations/discovery-presentation'
  import DiscoveryFacts from '$lib/components/cards/DiscoveryFacts.svelte'
  import DiscoveryTile from '$lib/components/cards/DiscoveryTile.svelte'
  import { mediaKey } from '$lib/catalog/identity'
  import { loadDiscoveryCandidates, discoveryPresentation } from '$lib/recommendations/candidates'
  import { catalogProviders, catalogLabel, mergedCatalogProviders } from '$lib/settings/catalog'
  import { activeProfile } from '$lib/profiles/store'
  import { profileAllowsMedia } from '$lib/profiles/content'
  import { developerLogging, showAdult } from '$lib/settings/ui'
  import { openTrailerPopup, closeTrailerPopup } from '$lib/stores/trailer'
  import Play from '@lucide/svelte/icons/play'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Film from '@lucide/svelte/icons/film'
  import Star from '@lucide/svelte/icons/star'
  import { WATCHLIST_ID, localLibrary, mediaIsInLocalList, setMediaInLocalList } from '$lib/library/local-lists'
  import { durableHistory } from '$lib/player/history'
  import {
    discoveryQueueFeedback,
    feedbackTasteSeeds,
    forgetDiscoveryDecision,
    historyTasteSeeds,
    libraryTasteSeeds,
    rankDiscoveryQueue,
    discoveryTasteItem,
    recordDiscoveryDecision,
    type DiscoveryQueueAction,
  } from '$lib/recommendations/discovery-queue'
  import { offlineMode } from '$lib/stores/offline'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Info from '@lucide/svelte/icons/info'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'

  type QueueFilter = 'all' | 'movie' | 'series' | 'anime'
  type LastDecision = { media: Media; action: DiscoveryQueueAction; alreadySaved: boolean }

  let pool = $state.raw<Media[]>([])
  let loading = $state(true)
  let loadingMore = $state(false)
  let error = $state('')
  let failedProviders = $state<string[]>([])
  let hasNextPage = $state(true)
  let enriched = $state.raw<Media | null>(null)
  let enriching = $state(false)
  let detailError = $state('')
  let mounted = $state(false)
  let nextPage = $state(1)
  let filter = $state<QueueFilter>('all')
  let lastDecision = $state<LastDecision | null>(null)
  let announcement = $state('')
  let cardOffset = $state(0)
  let pointerId = $state<number | null>(null)
  let restoredKey = $state<string | null>(null)
  let failedImages = $state<string[]>([])
  let loadedLogos = $state<string[]>([])
  let feature = $state<HTMLElement>()
  let pointerMediaKey = ''
  let pointerOrigin = 0
  let loadAbort: AbortController | null = null

  const ranked = $derived.by(() => {
    const candidates = pool.filter(media => (!$showAdult ? !media.isAdult : true) && profileAllowsMedia(media, $activeProfile))
      .filter(media => filter === 'all' || (filter === 'movie' ? media.format === 'MOVIE' || media.catalog?.type === 'movie'
        : filter === 'anime' ? !media.catalog || media.catalog.type === 'anime' || media.type === 'ANIME'
        : media.format !== 'MOVIE' && media.catalog?.type !== 'movie' && media.type !== 'MANGA'))
    const seeds = [
      ...libraryTasteSeeds($localLibrary),
      ...historyTasteSeeds($durableHistory),
      ...feedbackTasteSeeds($discoveryQueueFeedback),
    ]
    return rankDiscoveryQueue(candidates, seeds, $discoveryQueueFeedback, {
      excludedKeys: [...Object.values($localLibrary.entries ?? {}), ...Object.values($durableHistory)]
        .flatMap(entry => { const item = discoveryTasteItem(entry.media); return [item.key, ...(item.aliases ?? [])] }),
      limit: 60,
    })
  })
  const current = $derived(ranked.find(item => mediaKey(item.media) === restoredKey) ?? ranked[0])
  const remaining = $derived(ranked.length)
  const currentIndex = $derived(current ? ranked.indexOf(current) : 0)
  const visiblePicks = $derived(discoveryWindow(ranked, currentIndex))
  const presented = $derived(enriched && current && mediaKey(enriched) === mediaKey(current.media) ? enriched : current?.media)
  const providerNames = $derived(mergedCatalogProviders($catalogProviders).map(catalogLabel).join(' · '))
  const displayRating = $derived(presented?.ratings?.[0]
    ? `${presented.ratings[0].score}/${presented.ratings[0].scale} · ${presented.ratings[0].source}`
    : presented?.averageScore ? `${Math.round(presented.averageScore)}/100 · ${catalogLabel(presented.catalog?.provider ?? 'anilist')}` : '')
  const trailerId = $derived(discoveryTrailerId(presented))
  const synopsis = $derived(parseCatalogDescription(presented?.description).synopsis)
  const titleLogo = $derived(presented?.logoImage && !failedImages.includes(presented.logoImage) ? presented.logoImage : '')
  const backdrop = $derived(presented?.bannerImage && !failedImages.includes(presented.bannerImage) ? presented.bannerImage : '')
  const poster = $derived(presented ? cover(presented) || presented.coverImage?.large || '' : '')
  const artwork = $derived(backdrop || (poster && !failedImages.includes(poster) ? poster : ''))

  function imageFailed(event: Event) {
    const url = (event.currentTarget as HTMLImageElement).getAttribute('src')
    if (url) failedImages = [...failedImages, url]
  }

  // Exploring a tile never records taste feedback or removes a title from the queue.
  function selectPick(index: number) {
    const pick = ranked[index]
    if (!pick) return
    pointerCancel()
    restoredKey = mediaKey(pick.media)
    announcement = `Now exploring ${title(pick.media)}. Pick ${index + 1} of ${remaining}.`
    void tick().then(() => {
      feature?.focus({ preventScroll: true })
      feature?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    })
  }

  $effect(() => {
    const media = current?.media
    enriched = null; detailError = ''; enriching = false
    if (!media) return
    const abort = new AbortController()
    enriching = true
    void discoveryPresentation(media, abort.signal).then(detail => {
      if (!abort.signal.aborted) {
        if (profileAllowsMedia(detail, $activeProfile) && ($showAdult || !detail.isAdult)) enriched = detail
        else pool = pool.filter(item => mediaKey(item) !== mediaKey(media))
      }
    }).catch(() => { if (!abort.signal.aborted) detailError = 'Extra details couldn’t load. You can still browse this pick.' })
      .finally(() => { if (!abort.signal.aborted) enriching = false })
    return () => { abort.abort(); closeTrailerPopup() }
  })

  $effect(() => {
    const context = JSON.stringify([$activeProfile.id, $catalogProviders])
    if (mounted && context) untrack(() => { lastDecision = null; restoredKey = null; void load(true) })
  })

  async function load(reset = false) {
    if (loadAbort && !reset) return
    if ($offlineMode) { loading = false; return }
    const page = reset ? 1 : nextPage
    if (reset) {
      loading = true
      pool = []
      nextPage = 1
    } else if (page > 1) loadingMore = true
    error = ''
    failedProviders = []
    if (reset) loadAbort?.abort()
    const abort = new AbortController()
    loadAbort = abort
    try {
      const result = await loadDiscoveryCandidates($catalogProviders, page, abort.signal)
      const media = result.media
      if (abort.signal.aborted || loadAbort !== abort) return
      const unique = new Map((reset ? media : [...pool, ...media]).map((item) => [mediaKey(item), item]))
      pool = [...unique.values()]
      nextPage = page + 1
      hasNextPage = result.hasNextPage
      failedProviders = result.failedProviders.map(catalogLabel)
    } catch (reason) {
      if (abort.signal.aborted || loadAbort !== abort) return
      error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      if (loadAbort === abort) {
        loading = false
        loadingMore = false
        loadAbort = null
      }
    }
  }

  onMount(() => {
    mounted = true
    return () => { loadAbort?.abort(); closeTrailerPopup() }
  })

  function decide(action: DiscoveryQueueAction) {
    if (!current) return
    const media = presented ?? current.media
    restoredKey = null
    const alreadySaved = mediaIsInLocalList($localLibrary, media, WATCHLIST_ID)
    if (action === 'save' && !alreadySaved) setMediaInLocalList(media, WATCHLIST_ID, true)
    recordDiscoveryDecision(media, action)
    lastDecision = { media, action, alreadySaved }
    announcement = action === 'save'
      ? `${title(media)} saved to your watchlist.`
      : action === 'dismiss'
        ? `${title(media)} marked not for me.`
        : `${title(media)} snoozed for seven days.`
    cardOffset = 0
    if (ranked.length < 12 && hasNextPage && nextPage <= 5 && !loadingMore) void load()
  }

  function undo() {
    if (!lastDecision) return
    const previous = lastDecision
    filter = 'all'
    forgetDiscoveryDecision(previous.media)
    if (previous.action === 'save' && !previous.alreadySaved) {
      setMediaInLocalList(previous.media, WATCHLIST_ID, false)
    }
    if (!pool.some(media => mediaKey(media) === mediaKey(previous.media))) pool = [previous.media, ...pool]
    restoredKey = mediaKey(previous.media)
    announcement = `${title(previous.media)} restored to the queue.`
    lastDecision = null
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('button, a')) return
    if (!current || pointerId !== null) return
    pointerMediaKey = mediaKey(current.media)
    pointerId = event.pointerId
    pointerOrigin = event.clientX
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* optional */ }
  }

  function pointerMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    cardOffset = Math.max(-180, Math.min(180, event.clientX - pointerOrigin))
  }

  function pointerEnd(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    pointerId = null
    try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* optional */ }
    if (current && mediaKey(current.media) === pointerMediaKey) {
      if (cardOffset <= -90) decide('skip')
      else if (cardOffset >= 90) decide('save')
    }
    cardOffset = 0
  }

  function pointerCancel() { pointerId = null; cardOffset = 0 }

  function changeFilter(value: QueueFilter) { filter = value; restoredKey = null; announcement = ''; pointerCancel() }

  function handleKey(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
    if ((event.target as HTMLElement | null)?.closest('button, a, input, select, textarea')) return
    if (event.key === 'ArrowRight') { event.preventDefault(); selectPick(currentIndex + 1) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); selectPick(currentIndex - 1) }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); decide('skip') }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); decide('save') }
    else if (event.key.toLowerCase() === 'u' && lastDecision) { event.preventDefault(); undo() }
  }
</script>
<svelte:head><title>Discover · izumi</title></svelte:head>
<LibraryNav />

<main class="discovery-page">
  <header class="page-heading">
    <div><h1>Discover</h1><p>A little familiar. A little unexpected. Your next great watch.</p></div>
    <a href="/app/library" data-focusable class="queue-button watchlist-link"><Bookmark size={16} /> My watchlist <ArrowRight size={15} /></a>
  </header>

  <div class="discovery-toolbar">
    <div class="filter-group" role="group" aria-label="Filter discovery queue">
      {#each [{ id: 'all', label: 'All picks' }, { id: 'movie', label: 'Movies' }, { id: 'series', label: 'Series' }, { id: 'anime', label: 'Anime' }] as option}
        <button type="button" data-focusable onclick={() => changeFilter(option.id as QueueFilter)} aria-pressed={filter === option.id} class="queue-button filter-button">{option.label}</button>
      {/each}
    </div>
    <button type="button" data-focusable onclick={undo} disabled={!lastDecision} class="queue-button undo-button"><RotateCcw size={16} /> Undo last</button>
  </div>
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  {#if lastDecision && announcement}<p class="decision-notice" aria-hidden="true">{announcement}</p>{/if}

  {#if $offlineMode}
    <section class="queue-state"><Film size={28} /><h2>Discovery needs a connection</h2><p>Your saved watchlist remains available offline.</p><a href="/app/library" data-focusable class="queue-button secondary-button">Open my lists</a></section>
  {:else if loading}
    <section aria-label="Loading discovery" aria-busy="true" class="discovery-loading">
      <div class="loading-feature skeloader"></div>
      <div class="loading-tiles" aria-hidden="true">{#each Array(5) as _}<div class="skeloader"></div>{/each}</div>
      <span class="sr-only">Finding your next watch…</span>
    </section>
  {:else if error && !pool.length}
    <section class="queue-state">
      <h2>Couldn’t load your picks</h2><p>{error}</p>
      <div class="state-actions"><a href="/app/settings/catalog" data-focusable class="queue-button primary-button">Catalog settings</a><button type="button" data-focusable onclick={() => load(true)} class="queue-button secondary-button"><RefreshCw size={16} /> Retry</button></div>
    </section>
  {:else if current && presented}
    <!-- Shortcuts belong to this focusable feature, never to the whole application. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <article bind:this={feature} id="discovery-feature" aria-label={`Discovery card for ${title(current.media)}`} aria-describedby="queue-shortcuts" tabindex="0" data-focusable onkeydown={handleKey} class="discovery-feature">
      <div class="feature-stage">
        <div class="discovery-art touch-pan-y select-none" class:poster-art={!backdrop}
          onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerCancel}
          role="img" aria-label="Swipe artwork right to save, left to skip">
          {#if artwork}
            {#key artwork}<img class="discovery-backdrop" src={artwork} alt="" draggable="false" fetchpriority="high" onerror={imageFailed} style:transform={`translateX(${cardOffset / 4}px)`} />{/key}
          {:else}<div class="missing-art"><Film size={56} strokeWidth={1} /><span>Artwork unavailable</span></div>{/if}
          <div class="art-shade"></div>
          {#if Math.abs(cardOffset) > 30}<span class="swipe-cue">{cardOffset > 0 ? 'Save to watchlist' : 'Skip for a week'}</span>{/if}
        </div>
        <div class="discovery-copy">
          <p class="discovery-eyebrow"><Sparkles size={15} />{current.exploration ? 'Beyond your usual' : 'Picked for you'}</p>
          <div class="title-treatment">
            <h2 class:sr-only={Boolean(titleLogo && loadedLogos.includes(titleLogo))}>{title(presented)}</h2>
            {#if titleLogo}{#key titleLogo}<img class="title-logo" class:logo-pending={!loadedLogos.includes(titleLogo)} src={titleLogo} alt="" onload={() => { loadedLogos = [...loadedLogos, titleLogo] }} onerror={imageFailed} />{/key}{/if}
          </div>
          <div class="feature-facts"><DiscoveryFacts facts={discoveryFacts(presented)} /></div>
          <div class="feature-genres">
            {#if displayRating}<span class="feature-rating"><Star size={13} fill="currentColor" /><span>{displayRating}</span></span>{/if}
            {#if presented.genres?.length}<span>{presented.genres.slice(0, 3).join(' · ')}</span>{/if}
          </div>
          <p class="discovery-synopsis">{synopsis || (enriching ? 'Finding the story behind this pick…' : 'No synopsis is available yet. Open full details to explore this title.')}</p>
          <div class="discovery-actions">
            {#if trailerId}<button type="button" data-focusable onclick={() => openTrailerPopup(trailerId!, title(presented!))} class="queue-button trailer-button"><Play size={17} fill="currentColor" /> Watch trailer</button>{/if}
            <button type="button" data-focusable onclick={() => decide('save')} class="queue-button save-button" class:trailer-button={!trailerId}><Bookmark size={17} /> Save to watchlist</button>
          </div>
          <div class="feature-links">
            <a href={mediaHref(current.media)} use:detailLink={presented} data-focusable class="queue-button details-link"><Info size={15} /> Full details <ArrowRight size={14} /></a>
            {#if !trailerId}<span class="trailer-status">{enriching ? 'Checking for a trailer…' : 'Trailer unavailable'}</span>{/if}
          </div>
        </div>
        <div class="feature-position">
          <button type="button" data-focusable class="queue-button" aria-label="Previous title" disabled={currentIndex === 0} onclick={() => selectPick(currentIndex - 1)}><ChevronLeft size={17} /></button>
          <span aria-label={`Pick ${currentIndex + 1} of ${remaining}`}><b>{String(currentIndex + 1).padStart(2, '0')}</b> / {String(remaining).padStart(2, '0')}</span>
          <button type="button" data-focusable class="queue-button" aria-label="Next title" disabled={currentIndex === remaining - 1} onclick={() => selectPick(currentIndex + 1)}><ChevronRight size={17} /></button>
        </div>
      </div>
      <div class="feature-bottom">
        <div class="recommendation-reason">
          <Sparkles size={18} aria-hidden="true" />
          <div><h3>Why this pick</h3><p>{current.reason}</p>
            {#if $developerLogging && current.evidence.length}<details><summary data-focusable tabindex="0">What connects it to you</summary><ul>{#each current.evidence as fact}<li>{fact}</li>{/each}</ul></details>{/if}
          </div>
        </div>
        <div class="feedback-actions">
          <button type="button" data-focusable onclick={() => decide('skip')} title="Hide this title for seven days" class="queue-button secondary-button">Skip for now <ArrowRight size={17} /></button>
          <button type="button" data-focusable onclick={() => decide('dismiss')} class="queue-button dismiss-button"><EyeOff size={15} /> Not for me</button>
        </div>
      </div>
    </article>

    <section class="discovery-rail" aria-label="Your discovery picks" aria-roledescription="carousel">
      <div class="rail-heading">
        <div><h2>More to discover</h2><p>Explore a title. Find your kind of story.</p></div>
        <div class="rail-controls">
          <span class="rail-count">{visiblePicks.start + 1}–{Math.min(visiblePicks.start + DISCOVERY_PAGE_SIZE, remaining)} <span>of {remaining}</span></span>
          <button type="button" data-focusable aria-label="Previous picks" disabled={visiblePicks.start === 0} onclick={() => selectPick(Math.max(0, visiblePicks.start - DISCOVERY_PAGE_SIZE))} class="queue-button rail-arrow"><ChevronLeft size={18} /></button>
          <button type="button" data-focusable aria-label="Next picks" disabled={visiblePicks.start + DISCOVERY_PAGE_SIZE >= remaining} onclick={() => selectPick(visiblePicks.start + DISCOVERY_PAGE_SIZE)} class="queue-button rail-arrow"><ChevronRight size={18} /></button>
        </div>
      </div>
      <ul class="pick-strip">
        {#each visiblePicks.items as pick, index (mediaKey(pick.media))}
          <li><DiscoveryTile media={mediaKey(pick.media) === mediaKey(current.media) ? presented : pick.media} selected={mediaKey(pick.media) === mediaKey(current.media)} onselect={() => selectPick(visiblePicks.start + index)} /></li>
        {/each}
      </ul>
    </section>
    {#if detailError}<p class="queue-notice" role="status">{detailError}</p>{/if}
    {#if failedProviders.length}<p class="queue-notice" role="status">Some catalogs couldn’t load this time. You can explore picks from the available catalogs.</p>{/if}
    {#if error}<p role="alert" class="queue-notice">Couldn’t fetch more picks. You can keep browsing this batch.<button type="button" data-focusable onclick={() => load()} class="queue-button underline">Retry</button></p>{/if}
    {#if hasNextPage}<div class="load-more"><button type="button" data-focusable onclick={() => load()} disabled={loadingMore} class="queue-button secondary-button"><RefreshCw size={15} class={loadingMore ? 'animate-spin' : ''} />{loadingMore ? 'Finding more picks…' : 'Find more picks'}</button></div>{/if}
  {:else}
    <section class="queue-state"><Sparkles size={28} /><h2>{filter === 'all' ? 'You’re caught up' : 'No picks in this filter'}</h2><p>{filter !== 'all' ? 'Try all picks to explore other titles from your catalogs.' : hasNextPage ? 'Load more picks to keep exploring. Skipped titles return after seven days.' : 'You’ve explored the available picks. Come back later for something new.'}</p>
      <div class="state-actions">
        {#if filter !== 'all'}<button type="button" data-focusable onclick={() => changeFilter('all')} class="queue-button secondary-button">Show all picks</button>{/if}
        {#if hasNextPage}<button type="button" data-focusable onclick={() => load()} disabled={loadingMore} class="queue-button secondary-button"><RefreshCw size={16} class={loadingMore ? 'animate-spin' : ''} />{loadingMore ? 'Finding more picks…' : 'More picks'}</button>{:else}<a href="/app/library" data-focusable class="queue-button secondary-button">Open my lists</a>{/if}
      </div>
    </section>
  {/if}

  <footer class="discovery-footer">
    <p id="queue-shortcuts">Focus the feature: ← → to explore · S to save · N to skip · U to undo. Swipe artwork right to save or left to skip.</p>
    <details><summary data-focusable tabindex="0">How your picks work</summary><p>From your enabled catalogs · {providerNames}</p><p>Recommendations use this profile’s library, watch history and discovery choices. Private playback history is never used. Shared genres, tags and creators help find connections; a little variety brings something unexpected. Watched and saved titles are left out. “Not for me” adjusts future picks. “Skip for now” hides a title for seven days.</p></details>
  </footer>
</main>

<style>
  .discovery-page { max-width: 1440px; margin-inline: auto; padding: 1.75rem 2rem 5rem; }
  .page-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
  h1 { font-size: clamp(1.7rem, 2.4vw, 2.2rem); font-weight: 800; line-height: 1.15; letter-spacing: -.035em; }
  .page-heading p, .rail-heading p { margin-top: .45rem; color: hsl(var(--muted-foreground)); font-size: .875rem; line-height: 1.5; }
  .watchlist-link { color: hsl(var(--muted-foreground)); }
  .discovery-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  .filter-group { display: flex; gap: .25rem; padding: .25rem; background: hsl(var(--secondary) / .6); border-radius: .65rem; }
  .filter-button { color: hsl(var(--muted-foreground)); }
  .filter-button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); font-weight: 750; }
  .queue-button { display: inline-flex; flex-shrink: 0; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .65rem .95rem; font-size: .8125rem; line-height: 1.4; white-space: nowrap; transition: background-color 160ms, color 160ms; }
  .queue-button:focus-visible, .discovery-feature:focus-visible, summary:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
  .queue-button:disabled { opacity: .35; cursor: default; }
  .undo-button, .dismiss-button { color: hsl(var(--muted-foreground)); }
  .primary-button { background: hsl(var(--foreground)); color: hsl(var(--background)); font-weight: 750; }
  .secondary-button { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); font-weight: 700; }
  .decision-notice { margin-bottom: 1rem; font-size: .8125rem; color: hsl(var(--foreground)); }
  .discovery-feature { border: 1px solid hsl(var(--border)); border-radius: 1rem; scroll-margin-top: 1rem; }
  .feature-stage { position: relative; isolation: isolate; min-height: 28rem; border-radius: 1rem 1rem 0 0; overflow: hidden; background: #101216; color: #fff; }
  .discovery-art { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
  .discovery-backdrop { position: absolute; inset: 0 0 0 auto; width: 78%; height: 100%; object-fit: cover; object-position: center 30%; }
  .art-shade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, #101216 3%, #101216f7 22%, #101216d9 39%, #10121670 61%, #1012160a 82%), linear-gradient(0deg, #101216b3, transparent 40%); }
  .poster-art .discovery-backdrop { width: 45%; object-fit: contain; object-position: center; padding: 1.75rem; }
  .poster-art .art-shade { background: linear-gradient(90deg, #101216 35%, #101216b3 52%, transparent 68%); }
  .missing-art { position: absolute; inset: 0 0 0 55%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; color: #aeb3bf; font-size: .75rem; }
  .discovery-copy { width: 58%; max-width: 43rem; position: relative; padding: 2.5rem; }
  .discovery-eyebrow { display: flex; align-items: center; gap: .5rem; font-size: .6875rem; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; color: #d8dbe2; }
  .title-treatment { position: relative; display: flex; flex-direction: column; justify-content: center; min-height: 6.5rem; margin: 1rem 0; }
  .title-treatment h2 { font-size: clamp(1.85rem, 3vw, 3.25rem); line-height: 1.08; font-weight: 850; letter-spacing: -.035em; overflow-wrap: anywhere; text-wrap: balance; }
  .title-logo { position: absolute; top: 50%; transform: translateY(-50%); display: block; width: min(100%, 22rem); height: 6.5rem; object-fit: contain; object-position: left center; filter: drop-shadow(0 2px 12px #0008); }
  .logo-pending { opacity: 0; }
  .feature-facts { font-size: .8125rem; color: #e3e5eb; }
  .feature-genres { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; margin-top: .6rem; font-size: .75rem; color: #c8cbd3; line-height: 1.6; }
  .feature-rating { display: inline-flex; align-items: center; gap: .4rem; color: #fff; font-weight: 700; }
  .discovery-synopsis { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin-top: 1rem; max-width: 52ch; color: #d0d3dc; font-size: .875rem; line-height: 1.75; }
  .discovery-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.4rem; }
  .discovery-actions .queue-button { min-height: 3rem; font-weight: 750; }
  .save-button { background: #ffffff14; color: #fff; border: 1px solid #ffffff50; }
  .trailer-button { background: #fff; color: #14161b; border: 1px solid #fff; }
  .feature-links { display: flex; align-items: center; flex-wrap: wrap; gap: .25rem .8rem; margin-top: .4rem; }
  .details-link { padding-inline: 0; color: #d5d8e0; }
  .trailer-status { color: #b3b9c6; font-size: .75rem; }
  .feature-position { position: absolute; right: 1rem; bottom: 1rem; display: flex; align-items: center; gap: .35rem; border-radius: .5rem; background: #101216e6; color: #b5bac5; font-size: .75rem; font-variant-numeric: tabular-nums; }
  .feature-position .queue-button { padding: 0; width: 2.75rem; color: #fff; }
  .feature-position b { color: #fff; font-weight: 750; }
  .swipe-cue { position: absolute; top: 35%; right: 5%; padding: .85rem 1rem; background: #101216ed; border: 1px solid #ffffff66; border-radius: .5rem; color: #fff; font-weight: 750; }
  .feature-bottom { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; padding: 1.25rem 1.75rem; background: hsl(var(--secondary) / .18); border-radius: 0 0 1rem 1rem; }
  .recommendation-reason { display: flex; align-items: flex-start; gap: .75rem; min-width: 0; }
  .recommendation-reason > :global(svg) { flex-shrink: 0; margin-top: .2rem; color: hsl(var(--muted-foreground)); }
  .recommendation-reason h3 { font-size: .75rem; font-weight: 750; }
  .recommendation-reason p { margin-top: .25rem; max-width: 54ch; color: hsl(var(--muted-foreground)); font-size: .8125rem; line-height: 1.6; }
  .recommendation-reason details { margin-top: .35rem; font-size: .75rem; color: hsl(var(--muted-foreground)); }
  summary { cursor: pointer; width: fit-content; min-height: 2.75rem; padding-block: .65rem; }
  .recommendation-reason ul { list-style: disc; padding-left: 1rem; margin-top: .4rem; line-height: 1.7; }
  .feedback-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; }
  .discovery-rail { margin-top: 2rem; }
  .rail-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
  .rail-heading h2 { font-size: 1.2rem; font-weight: 800; letter-spacing: -.025em; }
  .rail-heading p { font-size: .8125rem; margin-top: .2rem; }
  .rail-controls { display: flex; align-items: center; gap: .45rem; }
  .rail-count { font-size: .75rem; white-space: nowrap; font-variant-numeric: tabular-nums; margin-right: .5rem; }
  .rail-count span { color: hsl(var(--muted-foreground)); }
  .rail-arrow { width: 2.75rem; padding: 0; border: 1px solid hsl(var(--border)); }
  .pick-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1rem; margin: -.3rem; padding: .3rem; }
  .pick-strip > li { min-width: 0; }
  .queue-notice { margin-top: 1rem; font-size: .8125rem; color: hsl(var(--muted-foreground)); line-height: 1.6; }
  .load-more { display: flex; justify-content: center; margin-top: 1.75rem; }
  .discovery-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid hsl(var(--border)); font-size: .75rem; line-height: 1.7; color: hsl(var(--muted-foreground)); }
  .discovery-footer details { margin-top: .3rem; }
  .discovery-footer details p { max-width: 80ch; margin-top: .6rem; }
  .queue-state { min-height: 24rem; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; border: 1px solid hsl(var(--border)); border-radius: 1rem; }
  .queue-state h2 { margin-top: 1rem; font-size: 1.4rem; font-weight: 750; }
  .queue-state p { margin: .75rem 0 1.25rem; max-width: 48ch; font-size: .875rem; line-height: 1.75; color: hsl(var(--muted-foreground)); }
  .state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: .6rem; }
  .loading-feature { height: 33rem; border-radius: 1rem; }
  .loading-tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-top: 2rem; }
  .loading-tiles > div { aspect-ratio: 16 / 11; border-radius: .5rem; }
  @media (hover: hover) {
    .queue-button:not(:disabled):hover { background: hsl(var(--foreground) / .1); }
    .filter-button[aria-pressed='true']:hover, .primary-button:hover { background: hsl(var(--foreground) / .85); }
    .save-button:hover { background: #ffffff26 !important; }
    .trailer-button:hover { background: #e2e5ec !important; }
    .details-link:hover { background: transparent !important; color: #fff; text-decoration: underline; }
  }
  @media (min-width: 1400px) { .feature-stage { min-height: 30rem; } .discovery-copy { padding: 3rem; } }
  @media (max-width: 1100px) { .discovery-copy { width: 66%; padding: 2rem; } .feature-bottom { padding: 1.25rem; } .feedback-actions { flex-direction: column; } .pick-strip { gap: .6rem; } }
  @media (max-width: 767px) {
    .discovery-page { padding: 1.25rem 1rem 6rem; }
    .page-heading { margin-bottom: 1.1rem; }
    .page-heading p { font-size: .8125rem; max-width: 34ch; }
    .watchlist-link { display: none; }
    .discovery-toolbar { gap: .5rem; flex-wrap: wrap; }
    .filter-group { flex: 1; justify-content: space-between; }
    .filter-button { padding-inline: .8rem; }
    .undo-button { padding-inline: .5rem; }
    .feature-stage { min-height: 0; }
    .discovery-art { height: 19rem; }
    .discovery-backdrop { width: 100%; height: 100%; object-position: center top; }
    .art-shade { background: linear-gradient(0deg, #101216 0%, #101216b3 18%, #10121600 75%); }
    .poster-art .discovery-backdrop { width: 100%; padding: .75rem; }
    .poster-art .art-shade { background: linear-gradient(0deg, #101216, transparent 40%); }
    .missing-art { inset: 0; padding-bottom: 3rem; }
    .discovery-copy { width: 100%; max-width: none; padding: 12.5rem 1.25rem 1.1rem; }
    .discovery-eyebrow { font-size: .625rem; width: fit-content; padding: .3rem .45rem; border-radius: .3rem; background: #101216d9; }
    .title-treatment { min-height: 5rem; margin: .8rem 0; }
    .title-treatment h2 { font-size: clamp(1.8rem, 6vw, 2.5rem); }
    .title-logo { height: 5rem; max-width: min(100%, 18rem); }
    .discovery-synopsis { margin-top: .8rem; }
    .discovery-actions { margin-top: 1.1rem; }
    .discovery-actions .queue-button { flex: 1; padding-inline: .7rem; }
    .feature-position { top: .8rem; right: .8rem; bottom: auto; }
    .feature-bottom { flex-direction: column; align-items: stretch; gap: 1rem; }
    .feedback-actions { flex-direction: row; justify-content: flex-start; }
    .feedback-actions .queue-button { flex: 1; }
    .rail-heading { flex-wrap: wrap; }
    .rail-heading h2 { font-size: 1.125rem; }
    .rail-heading p { display: none; }
    .rail-controls { gap: .3rem; }
    .rail-count { margin-right: .15rem; }
    .pick-strip { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: .4rem; gap: .65rem; padding: .4rem .4rem .8rem; scrollbar-width: thin; }
    .pick-strip > li { flex: 0 0 11rem; scroll-snap-align: start; }
    .loading-feature { height: 39rem; }
    .loading-tiles { grid-template-columns: repeat(2, 1fr); }
    .loading-tiles > div:nth-child(n+3) { display: none; }
  }
  @media (max-width: 380px) { .discovery-actions { flex-direction: column; } .filter-button { padding-inline: .65rem; } .rail-count { display: none; } }
  @media (prefers-reduced-motion: reduce) { .queue-button { transition: none; } .discovery-backdrop { transform: none !important; } .skeloader::before { animation: none; } :global(.discovery-page .animate-spin) { animation: none; } }
</style>
