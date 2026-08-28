<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title, format, season, status, totalEpisodes, mediaHref } from '$lib/anilist/media'
  import { rememberDetail } from '$lib/anilist/detail-hint'
  import { goto } from '$app/navigation'
  import { anilistToken } from '$lib/anilist/auth'
  import { toggleFavourite, setStatus, anyTrackerConnected } from '$lib/trackers'
  import YoutubeTrailer from './YoutubeTrailer.svelte'
  import Play from '@lucide/svelte/icons/play'
  import Heart from '@lucide/svelte/icons/heart'
  import Plus from '@lucide/svelte/icons/plus'
  import BookOpen from '@lucide/svelte/icons/book-open'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  let { media }: { media: Media } = $props()

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
    if (media.averageScore != null) values.push(`${media.averageScore}%`)
    return [...new Set(values.filter(Boolean))].join(' · ')
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
      <div class="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-foreground/75">
        <AddonLogo logo={jvmSource.sourceIcon} name={jvmSource.sourceName} id={jvmSource.id} size={15} />
        <span class="truncate">{jvmSource.sourceName}</span>
        {#if jvmSource.sourceLanguage}<span class="shrink-0 uppercase text-muted-foreground">· {jvmSource.sourceLanguage}</span>{/if}
      </div>
    {/if}
    {#if metadata}<div class="mt-2 text-[11px] text-muted-foreground">{metadata}</div>{/if}
    {#if media.creators?.length}<div class="mt-1 truncate text-[0.7rem] text-muted-foreground">By {media.creators.join(', ')}</div>{/if}
    {#if cleanDescription}
      <p class="mt-1 line-clamp-4 text-[0.7rem] text-muted-foreground">{cleanDescription}</p>
    {:else if jvmSource}
      <p class="mt-1 text-[0.7rem] text-muted-foreground">Open to load full details and episodes from {jvmSource.sourceName}.</p>
    {/if}
  </div>
</div>
