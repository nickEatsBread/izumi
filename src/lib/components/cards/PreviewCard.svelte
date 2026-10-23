<script lang="ts">
  import type { Media, MediaRating } from '$lib/anilist/types'
  import { banner, title, format, season, status, totalEpisodes, mediaHref } from '$lib/anilist/media'
  import { rememberDetail } from '$lib/anilist/detail-hint'
  import { goto } from '$app/navigation'
  import {
    anilistToken, kitsuToken, malToken, simklToken, trackerConnectionOrder,
  } from '$lib/trackers/config'
  import { preferredConnectedTracker } from '$lib/trackers/connection-order'
  import {
    communityRatingKey, loadProviderCommunityRating, providerRatingOnMedia,
  } from '$lib/trackers/community-rating'
  import { toggleFavourite } from '$lib/trackers'
  import { WATCHLIST_ID, localLibrary, mediaIsInLocalList, toggleMediaInLocalList } from '$lib/library/local-lists'
  import YoutubeTrailer from './YoutubeTrailer.svelte'
  import { youtubeTrailerId } from './youtube-embed'
  import Play from '@lucide/svelte/icons/play'
  import Heart from '@lucide/svelte/icons/heart'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import BookOpen from '@lucide/svelte/icons/book-open'
  import Check from '@lucide/svelte/icons/check'
  import Plus from '@lucide/svelte/icons/plus'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import CatalogSourceAttribution from '$lib/components/catalog/CatalogSourceAttribution.svelte'
  import { compactRatingLabel, primaryRating } from '$lib/catalog/media-metadata'
  import RatingSourceMark from '$lib/components/catalog/RatingSourceMark.svelte'
  let { media, preferLinkedRating = false, variant = 'popup', artHeight, logo }: {
    media: Media
    preferLinkedRating?: boolean
    /** `expand`: the API 6 preview that grows out of its card (`cardPreview: "expand"`). */
    variant?: 'popup' | 'expand'
    /** The expand art's height in local px (expand-pos.ts); 16:9 when absent. */
    artHeight?: number
    /** The title logo over the expand art, when the card has one; else the title. */
    logo?: string
  } = $props()
  let failedLogo = $state(false)
  $effect(() => { void logo; failedLogo = false })

  // YouTube trailers only. The iframe stays transparent until the video plays and a failed embed
  // removes it (YoutubeTrailer's dead state), so the artwork shows whenever the trailer cannot.
  const trailerId = $derived(youtubeTrailerId(media.trailer))

  // Favourite is AniList-only. Watchlist saving is device-local and never requires an account.
  const canFavourite = $derived(!!$anilistToken)
  const inWatchlist = $derived(mediaIsInLocalList($localLibrary, media, WATCHLIST_ID))
  let busy = $state(false)
  async function favourite(e: Event) { e.stopPropagation(); if (busy) return; busy = true; try { await toggleFavourite(media) } catch { /* ignore */ } finally { busy = false } }
  function bookmark(e: Event) { e.stopPropagation(); toggleMediaInLocalList(media, WATCHLIST_ID) }
  const reading = $derived(media.type === 'MANGA')
  const jvmSource = $derived(media.catalog?.provider === 'jvm' && media.catalog.sourceName ? media.catalog : undefined)
  const cleanDescription = $derived((media.description ?? '').replace(/<[^>]+>/g, '').trim())
  const metadata = $derived.by(() => {
    const values = reading
      ? [format(media), media.chapters ? `${media.chapters} chapters` : '', media.volumes ? `${media.volumes} volumes` : '']
      : [
          format(media),
          media.seasonNumber ? `Season ${media.seasonNumber}` : '',
          totalEpisodes(media) ? `${totalEpisodes(media)} eps` : '',
          season(media),
          status(media),
        ]
    return [...new Set(values.filter(Boolean))].join(' · ')
  })
  const preferredRatingProvider = $derived(preferLinkedRating ? preferredConnectedTracker({
    anilist: !!$anilistToken,
    mal: !!$malToken,
    kitsu: !!$kitsuToken,
    simkl: !!$simklToken,
  }, $trackerConnectionOrder) : undefined)
  const embeddedPreferredRating = $derived(preferredRatingProvider
    ? providerRatingOnMedia(media, preferredRatingProvider)
    : undefined)
  const preferredRatingKey = $derived(preferredRatingProvider
    ? communityRatingKey(media, preferredRatingProvider)
    : undefined)
  let fetchedRating = $state<MediaRating | undefined>()
  let fetchedRatingKey = $state('')
  let fetchedRatingSettled = $state(false)

  // Automatic anime cards follow the user's account-link order. Keep the rating empty during the
  // first provider lookup so an AniList badge never flashes before the linked provider replaces it.
  $effect(() => {
    const provider = preferredRatingProvider
    const embedded = embeddedPreferredRating
    const key = preferredRatingKey
    fetchedRating = undefined
    fetchedRatingKey = key ?? ''
    fetchedRatingSettled = !!embedded || !key
    if (!provider || embedded || !key) return
    let current = true
    void loadProviderCommunityRating(media, provider).then((rating) => {
      if (!current) return
      fetchedRating = rating
      fetchedRatingSettled = true
    })
    return () => { current = false }
  })

  const previewRating = $derived.by(() => {
    const fallback = primaryRating(media)
    if (!preferLinkedRating || !preferredRatingProvider) return fallback
    if (embeddedPreferredRating) return embeddedPreferredRating
    if (!preferredRatingKey) return fallback
    if (fetchedRatingKey !== preferredRatingKey || !fetchedRatingSettled) return undefined
    return fetchedRating ?? fallback
  })
  const openDetail = () => { rememberDetail(media); goto(mediaHref(media)) }
</script>

{#if variant === 'expand'}
<div data-part="preview" data-variant="expand" class="w-full cursor-pointer overflow-hidden rounded-md bg-card shadow-2xl ring-1 ring-border"
     onclick={openDetail} role="link" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openDetail() }}>
  <div data-part="preview.art" class="relative overflow-hidden bg-black" style:height={artHeight ? `${artHeight}px` : undefined} class:aspect-video={!artHeight}>
    <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
    {#if trailerId}<YoutubeTrailer id={trailerId} title={title(media)} />{/if}
    <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(45deg,rgba(0,0,0,.6),rgba(0,0,0,.4)_15%,transparent_40%)]"></div>
    {#if logo && !failedLogo}
      <img data-part="preview.logo" src={logo} alt={title(media)} onerror={() => (failedLogo = true)} class="pointer-events-none absolute bottom-3 left-3 max-h-[35%] max-w-[45%] object-contain object-left-bottom" />
    {:else}
      <div data-part="preview.title" class="pointer-events-none absolute inset-x-3 bottom-3 truncate text-lg font-black text-white drop-shadow">{title(media)}</div>
    {/if}
  </div>
  <div class="flex flex-col gap-2 p-4">
    <div data-part="preview.actions" class="flex items-center gap-2">
      <button data-part="preview.action" data-action="play" aria-label={reading ? 'Information' : 'Play'} onclick={(e) => { e.stopPropagation(); openDetail() }}
              class="grid size-9 place-items-center rounded-full bg-white text-black">{#if reading}<BookOpen size={16} />{:else}<Play size={16} fill="currentColor" />{/if}</button>
      {#if !reading}
        <button data-part="preview.action" data-action="list" aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'} onclick={bookmark}
                class="grid size-9 place-items-center rounded-full border-2 border-white/50 bg-black/40 text-white">{#if inWatchlist}<Check size={16} />{:else}<Plus size={16} />{/if}</button>
        {#if canFavourite}
          <button data-part="preview.action" data-action="favorite" aria-label="Favourite" onclick={favourite} disabled={busy}
                  class="grid size-9 place-items-center rounded-full border-2 border-white/50 bg-black/40 text-white disabled:opacity-40"><Heart size={16} /></button>
        {/if}
      {/if}
      <button data-part="preview.action" data-action="details" aria-label="More details" onclick={(e) => { e.stopPropagation(); openDetail() }}
              class="ml-auto grid size-9 place-items-center rounded-full border-2 border-white/50 bg-black/40 text-white"><ChevronDown size={18} /></button>
    </div>
    <div data-part="preview.meta" class="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      {#if previewRating}<span data-part="card.score" class="flex items-center gap-1 font-bold text-foreground/80"><RatingSourceMark source={previewRating.source} />{compactRatingLabel(previewRating)}</span>{/if}
      {#if metadata}<span>{metadata}</span>{/if}
    </div>
    {#if media.genres?.length}
      <div data-part="preview.genres" class="flex flex-wrap gap-x-2 text-sm text-foreground">
        {#each media.genres.slice(0, 3) as genre, index}{#if index}<span class="text-muted-foreground" aria-hidden="true">•</span>{/if}<span>{genre}</span>{/each}
      </div>
    {/if}
  </div>
</div>
{:else}
<div data-part="card" data-family="preview" class="preview-in w-[17.5rem] cursor-pointer overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border"
     onclick={openDetail} role="link" tabindex="0"
     onkeydown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openDetail() }}>
  <div data-part="card.art" class="relative h-40 overflow-hidden bg-muted">
    <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
    {#if trailerId}
      <YoutubeTrailer id={trailerId} title={title(media)} />
    {/if}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"></div>
  </div>
  <div class="p-3">
    <div data-part="card.title" class="truncate font-black">{title(media)}</div>
    <div class="mt-2 flex gap-2">
      <button onclick={openDetail}
              class="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary py-1 text-sm font-bold text-primary-foreground">
        {#if reading}<BookOpen size={14} /> Information{:else}<Play size={14} /> Play{/if}
      </button>
      {#if !reading}
        <button aria-label="Favorite" onclick={favourite} disabled={!canFavourite || busy}
                title={canFavourite ? 'Favourite' : 'Connect AniList to favourite'}
                class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground disabled:opacity-40">
          <Heart size={16} />
        </button>
        <button aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'} onclick={bookmark}
                title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground">
          <Bookmark size={16} class={inWatchlist ? 'fill-current text-theme' : ''} />
        </button>
      {/if}
    </div>
    {#if jvmSource}
      <div class="mt-2 text-[11px] font-semibold text-foreground/75">
        <CatalogSourceAttribution {media} />
      </div>
    {/if}
    <div data-part="card.meta" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {#if previewRating}<span data-part="card.score" class="flex items-center gap-1 font-bold text-foreground/80" title={`${previewRating.source} rating`}><RatingSourceMark source={previewRating.source} />{compactRatingLabel(previewRating)}</span>{/if}
      {#if metadata}<span>{metadata}</span>{/if}
    </div>
    {#if media.creators?.length}<div class="mt-1 truncate text-[0.7rem] text-muted-foreground">By {media.creators.join(', ')}</div>{/if}
    {#if cleanDescription}
      <p class="mt-1 line-clamp-4 text-[0.7rem] text-muted-foreground">{cleanDescription}</p>
    {:else if jvmSource}
      <p class="mt-1 text-[0.7rem] text-muted-foreground">Open to load full details and episodes from {jvmSource.sourceName}.</p>
    {/if}
  </div>
</div>
{/if}
