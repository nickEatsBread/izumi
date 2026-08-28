<script lang="ts">
  import { goto } from '$app/navigation'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import Play from '@lucide/svelte/icons/play'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Star from '@lucide/svelte/icons/star'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import CatalogSourceAttribution from './CatalogSourceAttribution.svelte'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import type { CatalogContentType, CatalogProviderId, MediaRef } from '$lib/catalog/identity'
  import { providerExternalUrl } from '$lib/catalog/identity'
  import { banner, cover, format, season, status, title } from '$lib/anilist/media'
  import type { Media, MediaVideo } from '$lib/anilist/types'
  import { detailHints } from '$lib/anilist/detail-hint'
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import { parseCatalogDescription } from '$lib/catalog/description'

  let { provider, type, id }: { provider: CatalogProviderId; type: CatalogContentType; id: string } = $props()
  const ref = $derived({ provider, type, id } as MediaRef)
  let media = $state<Media | null>(null)
  let loading = $state(true)
  let error = $state('')
  let playState = $state<PlayState>({ status: 'idle' })
  let retry = $state(0)
  let failedLogo = $state('')

  $effect(() => {
    const request = ref
    void retry
    if (request.provider === 'anilist') return
    const abort = new AbortController()
    loading = true
    error = ''
    media = null
    void loadCatalogProvider(request.provider).then((catalog) => catalog.detail(request, abort.signal)).then((result) => {
      if (!abort.signal.aborted) media = result
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })

  const videos = $derived.by((): MediaVideo[] => {
    if (!media) return []
    if (media.videos?.length) return media.videos
    return Array.from({ length: media.episodes ?? 0 }, (_, index) => ({ number: index + 1, episode: index + 1 }))
  })
  const recommendations = $derived(media?.recommendations?.nodes.flatMap((node) => node.mediaRecommendation ? [node.mediaRecommendation] : []) ?? [])
  const relations = $derived(media?.relations?.edges.map((edge) => edge.node) ?? [])
  const cast = $derived(media?.characters?.edges ?? [])
  const crew = $derived(media?.staff?.edges ?? [])
  const externalUrl = $derived(media ? providerExternalUrl(media) : null)
  const isMovie = $derived(media?.catalog?.type === 'movie' || media?.format === 'MOVIE')
  const titleLogo = $derived(media?.logoImage && media.logoImage !== failedLogo ? media.logoImage : '')
  const parsedDescription = $derived(parseCatalogDescription(media?.description))
  const attributedMedia = $derived.by(() => {
    if (!media || media.catalog?.provider !== 'jvm') return media
    const remembered = $detailHints[media.id]
    const alternatives = [...(media.catalogAlternatives ?? []), ...(remembered?.catalogAlternatives ?? [])]
    return alternatives.length ? { ...media, catalogAlternatives: alternatives } : media
  })

  function play(video?: MediaVideo) {
    if (!media) return
    const episode = isMovie ? undefined : video?.number ?? 1
    void playEpisode(media, episode, (state) => (playState = state))
  }

  function titleLogoFailed(event: Event) {
    failedLogo = (event.currentTarget as HTMLImageElement).src
  }
</script>

{#if loading}
  <div class="min-h-screen">
    <div class="h-[48vh] skeloader"></div>
    <div class="space-y-4 p-5 sm:p-8"><div class="h-10 w-2/3 rounded skeloader"></div><div class="h-24 rounded skeloader"></div></div>
  </div>
{:else if error || !media}
  <div class="grid min-h-[70vh] place-items-center p-6">
    <div class="max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
      <h1 class="text-xl font-black">{error ? 'Couldn’t load this title' : 'Title not found'}</h1>
      {#if error}<p class="mt-2 text-sm text-muted-foreground">{error}</p>{/if}
      <button data-focusable onclick={() => retry++} class="mt-4 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Retry</button>
    </div>
  </div>
{:else}
  <div class="pb-20">
    <section class="relative min-h-[52vh] overflow-hidden">
      <img src={banner(media)} alt="" class="absolute inset-0 h-full w-full object-cover" />
      <div class="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/15"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/35"></div>
      <button data-focusable onclick={() => history.length > 1 ? history.back() : goto('/app/home')} aria-label="Back"
        class="absolute left-4 top-10 z-10 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur sm:left-8"><ChevronLeft size={22} /></button>
      <div class="relative flex min-h-[52vh] max-w-6xl items-end gap-8 px-5 pb-8 pt-24 sm:px-8">
        <img src={cover(media)} alt="" class="hidden aspect-[2/3] rounded-xl bg-muted object-cover shadow-2xl md:block md:w-48 lg:w-56 xl:w-64" />
        <div class="min-w-0 flex-1">
          {#if provider !== 'tmdb' && provider !== 'jvm'}
            <div class="mb-2 text-xs font-black uppercase tracking-[0.18em] text-theme">{provider === 'kitsu' ? 'Kitsu' : 'Stremio metadata'}</div>
          {/if}
          {#if titleLogo}
            <h1 aria-label={title(media)} class="h-28 w-[min(34rem,82vw)]">
              <img src={titleLogo} alt="" loading="eager" decoding="async"
                   onerror={titleLogoFailed}
                   class="h-full w-full object-contain object-left drop-shadow-[2px_2px_6px_rgba(0,0,0,.85)]" />
            </h1>
          {:else}
            <h1 class="text-3xl font-black leading-tight sm:text-5xl">{title(media)}</h1>
          {/if}
          <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground/75">
            {#if format(media)}<span>{format(media)}</span>{/if}
            {#if season(media)}<span>{season(media)}</span>{/if}
            {#if status(media)}<span>{status(media)}</span>{/if}
            {#if media.startDate?.year}<span>{media.startDate.year}</span>{/if}
            {#if parsedDescription.score != null}
              <span class="flex items-center gap-1"><Star size={14} class="fill-current text-amber-300" /> {parsedDescription.score.toFixed(1)}</span>
            {:else if media.averageScore}<span>{media.averageScore}%</span>{/if}
          </div>
          {#if parsedDescription.synopsis}
            <p class="mt-4 line-clamp-5 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-foreground/80 sm:text-base">{parsedDescription.synopsis}</p>
          {/if}
          {#if provider === 'jvm' && attributedMedia?.catalog?.sourceName}
            <div class="mt-4 max-w-full text-sm font-bold text-foreground/75">
              <div class="mb-1 text-xs font-semibold text-muted-foreground">Available from</div>
              <CatalogSourceAttribution media={attributedMedia} iconSize={20} />
            </div>
          {/if}
          <div class="mt-5 flex flex-wrap gap-2">
            <button data-focusable onclick={() => play(videos[0])} class="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-black text-primary-foreground"><Play size={19} class="fill-current" /> {isMovie ? 'Play' : 'Play episode 1'}</button>
            {#if externalUrl}
              <button data-focusable onclick={() => openUrl(externalUrl)} class="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 font-bold"><ExternalLink size={17} /> {provider === 'tmdb' ? 'TMDB' : 'Open provider'}</button>
            {/if}
          </div>
          {#if playState.status === 'error'}<p class="mt-3 text-sm text-destructive">{playState.message}</p>{/if}
        </div>
      </div>
    </section>

    {#if media.genres?.length}<div class="flex flex-wrap gap-2 px-5 sm:px-8">{#each media.genres as genre}<span class="rounded-full bg-secondary px-3 py-1 text-xs font-bold">{genre}</span>{/each}</div>{/if}

    {#if parsedDescription.facts.length || parsedDescription.alternativeTitles.length || parsedDescription.links.length}
      <section class="mt-6 max-w-6xl px-5 sm:px-8" aria-label="Source information">
        <div class="rounded-2xl bg-secondary/55 p-4 sm:p-5">
          <h2 class="mb-4 text-sm font-black uppercase tracking-wide text-foreground/70">Information</h2>
          {#if parsedDescription.facts.length}
            <dl class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {#each parsedDescription.facts as fact (fact.label)}
                <div class="min-w-0">
                  <dt class="text-xs font-semibold text-muted-foreground">{fact.label}</dt>
                  <dd class="mt-0.5 break-words text-sm font-bold text-foreground/90">{fact.value}</dd>
                </div>
              {/each}
            </dl>
          {/if}
          {#if parsedDescription.alternativeTitles.length}
            <div class="mt-5">
              <div class="text-xs font-semibold text-muted-foreground">Alternative titles</div>
              <div class="mt-1 text-sm text-foreground/85">{parsedDescription.alternativeTitles.join(' · ')}</div>
            </div>
          {/if}
          {#if parsedDescription.links.length}
            <div class="mt-5 flex flex-wrap gap-2" aria-label="External links">
              {#each parsedDescription.links as link (link.url)}
                <button data-focusable onclick={() => openUrl(link.url)} class="flex items-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm font-bold transition hover:bg-background">
                  {link.label}<ExternalLink size={14} class="text-muted-foreground" />
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {/if}

    {#if !isMovie && videos.length}
      <section class="mt-8 px-5 sm:px-8">
        <h2 class="mb-4 text-xl font-black">Episodes <span class="text-sm font-normal text-muted-foreground">{videos.length}</span></h2>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each videos as video (video.id ?? video.number)}
            <button data-focusable onclick={() => play(video)} class="group flex min-h-16 items-center gap-3 rounded-lg bg-secondary/60 p-2 text-left hover:bg-secondary">
              {#if video.thumbnail}<img src={video.thumbnail} alt="" loading="lazy" class="aspect-video w-24 rounded-md bg-muted object-cover" />{/if}
              <span class="min-w-0"><span class="block text-xs text-muted-foreground">{video.season != null && video.episode != null ? `S${video.season} E${video.episode}` : `Episode ${video.number}`}</span><span class="line-clamp-2 text-sm font-bold">{video.title || `Episode ${video.number}`}</span></span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if relations.length}<div class="mt-8"><Carousel title="Related">{#each relations as item (item.catalog?.id ?? item.id)}<SmallCard media={item} />{/each}</Carousel></div>{/if}
    {#if recommendations.length}<div class="mt-8"><Carousel title="Recommendations">{#each recommendations as item (item.catalog?.id ?? item.id)}<SmallCard media={item} />{/each}</Carousel></div>{/if}

    {#if cast.length || crew.length}
      <section class="mt-8 px-5 sm:px-8">
        <h2 class="mb-4 text-xl font-black">Cast & crew</h2>
        <div class="flex gap-3 overflow-x-auto pb-2">
          {#each [...cast.slice(0, 14), ...crew.slice(0, 10)] as credit, index (`${credit.node.id}:${index}`)}
            <div class="w-28 shrink-0">
              {#if credit.node.image?.large}<img src={credit.node.image.large} alt="" loading="lazy" class="aspect-[2/3] w-full rounded-lg bg-muted object-cover" />{:else}<div class="grid aspect-[2/3] place-items-center rounded-lg bg-secondary text-3xl font-black text-muted-foreground">{credit.node.name.full?.[0] ?? '?'}</div>{/if}
              <div class="mt-1 line-clamp-2 text-xs font-bold">{credit.node.name.full}</div><div class="truncate text-[0.65rem] text-muted-foreground">{credit.role}</div>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}
