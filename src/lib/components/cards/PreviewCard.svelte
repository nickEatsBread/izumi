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
  import { toggleFavourite, setStatus, anyTrackerConnected } from '$lib/trackers'
  import YoutubeTrailer from './YoutubeTrailer.svelte'
  import Play from '@lucide/svelte/icons/play'
  import Heart from '@lucide/svelte/icons/heart'
  import Plus from '@lucide/svelte/icons/plus'
  import BookOpen from '@lucide/svelte/icons/book-open'
  import CatalogSourceAttribution from '$lib/components/catalog/CatalogSourceAttribution.svelte'
  import { compactRatingLabel, primaryRating } from '$lib/catalog/media-metadata'
  import RatingSourceMark from '$lib/components/catalog/RatingSourceMark.svelte'
  let { media, preferLinkedRating = false }: { media: Media; preferLinkedRating?: boolean } = $props()

  // YouTube trailers only; WebKitGTK (no `credentialless`) will just show the still.
  const trailerId = $derived(
    media.trailer?.id && (!media.trailer.site || media.trailer.site.toLowerCase() === 'youtube')
      ? media.trailer.id
      : undefined,
  )

  // Favourite is AniList-only; bookmark (PLANNING) works on any connected tracker.
  const canFavourite = $derived(!!$anilistToken)
  const canBookmark = $derived(anyTrackerConnected())
  let busy = $state(false)
  async function favourite(e: Event) { e.stopPropagation(); if (busy) return; busy = true; try { await toggleFavourite(media) } catch { /* ignore */ } finally { busy = false } }
  async function bookmark(e: Event) { e.stopPropagation(); if (busy) return; busy = true; try { await setStatus(media, 'PLANNING') } finally { busy = false } }
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

<div class="preview-in w-[17.5rem] cursor-pointer overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border"
     onclick={openDetail} role="link" tabindex="0"
     onkeydown={(e) => { if (e.key === 'Enter') openDetail() }}>
  <div class="relative h-40 overflow-hidden bg-muted">
    <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
    {#if trailerId}
      <YoutubeTrailer id={trailerId} title={title(media)} />
    {/if}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"></div>
  </div>
  <div class="p-3">
    <div class="truncate font-black">{title(media)}</div>
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
        <button aria-label="Add to list" onclick={bookmark} disabled={!canBookmark || busy}
                title={canBookmark ? 'Add to Planning' : 'Connect a tracker to bookmark'}
                class="grid place-items-center rounded-md bg-secondary px-2 py-1 text-secondary-foreground disabled:opacity-40">
          <Plus size={16} />
        </button>
      {/if}
    </div>
    {#if jvmSource}
      <div class="mt-2 text-[11px] font-semibold text-foreground/75">
        <CatalogSourceAttribution {media} />
      </div>
    {/if}
    <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {#if previewRating}<span class="flex items-center gap-1 font-bold text-foreground/80" title={`${previewRating.source} rating`}><RatingSourceMark source={previewRating.source} />{compactRatingLabel(previewRating)}</span>{/if}
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
