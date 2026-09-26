<script lang="ts">
  import { onMount } from 'svelte'
  import { mediaHref, title as mediaTitle } from '$lib/anilist/media'
  import { releasedAgo } from '$lib/anime/airing-labels'
  import { getEpisodeMeta } from '$lib/anizip'
  import * as h from '$lib/haptics'
  import type { LatestEpisodesBlock } from '$lib/home/blocks'
  import { appendReleases, loadLatestEpisodes, releaseKey, releaseStill, type EpisodeRelease } from '$lib/home/latest-episodes'
  import { isMobile } from '$lib/platform'
  import type { PlayState } from '$lib/stremio/play'
  import { nearViewport } from '$lib/util/near-viewport'
  import Pager from '../Pager.svelte'

  // Newly aired episodes as 16:9 stills, newest first. The still plays the episode; the title opens the series.
  let { block }: { block: LatestEpisodesBlock } = $props()

  // Page backwards from the moment the block mounted, so a page stays put while new episodes air.
  const before = Math.floor(Date.now() / 1000)
  let section = $state<HTMLElement>()
  let visible = $state(false)
  let page = $state(1)
  let items = $state.raw<EpisodeRelease[]>([])
  let hasNext = $state(false)
  let lastPage = $state<number | undefined>()
  let loading = $state(false)
  let error = $state('')
  let stills = $state<Record<string, string>>({})
  let playing = $state<string | null>(null)
  let now = $state(Date.now())

  const columns = $derived($isMobile ? Math.min(2, block.columns) : block.columns)

  $effect(() => {
    if (!visible) return
    const pageNumber = page
    const size = block.pageSize
    const append = block.pagination === 'more' && pageNumber > 1
    let cancelled = false
    loading = true
    error = ''
    loadLatestEpisodes(pageNumber, size, before).then((result) => {
      if (cancelled) return
      items = append ? appendReleases(items, result.items) : result.items
      hasNext = result.hasNextPage
      lastPage = result.lastPage
    }).catch((reason) => {
      if (!cancelled) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => { if (!cancelled) loading = false })
    return () => { cancelled = true }
  })

  // Episode stills come from per-series episode metadata (cached on the device); the banner shows until then.
  $effect(() => {
    for (const release of items) {
      const key = releaseKey(release)
      void getEpisodeMeta(release.media.id).then((meta) => {
        const image = meta[release.episode]?.image
        if (image && stills[key] !== image) stills = { ...stills, [key]: image }
      }).catch(() => {})
    }
  })

  function goTo(next: number) {
    page = next
    if (block.pagination === 'numbers') section?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  async function play(release: EpisodeRelease) {
    if (playing) return
    h.tap()
    playing = releaseKey(release)
    error = ''
    try {
      const [{ playEpisode }, { fetchMediaByIds }] = await Promise.all([import('$lib/stremio/play'), import('$lib/anilist/fetch-media')])
      const detailed = (await fetchMediaByIds([release.media.id])).get(release.media.id) ?? release.media
      await playEpisode(detailed, release.episode, (state: PlayState) => {
        if (state.status !== 'resolving') playing = null
        if (state.status === 'error') error = state.message ?? 'No source was found.'
      })
    } catch {
      playing = null
    }
  }

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
</script>

<section bind:this={section} data-block data-slot="block.latest-episodes" data-nav-row data-nav-row-wrap="" use:nearViewport={{ onEnter: () => (visible = true) }}
  class="mb-8 scroll-mt-20 px-4 sm:px-8">
  <h2 data-part="block.title" class="mb-3 text-lg font-black">{block.title || 'Latest episodes'}</h2>
  {#if error}<p role="alert" class="mb-3 text-sm text-muted-foreground">{error}</p>{/if}
  <div data-nav-row-items class="grid gap-x-3 gap-y-4" style:grid-template-columns={`repeat(${columns}, minmax(0, 1fr))`}>
    {#if !visible || (loading && !items.length)}
      {#each Array.from({ length: block.pageSize }) as _, index (index)}
        <div><div class="aspect-video rounded-lg skeloader"></div><div class="mt-2 h-4 w-3/4 rounded skeloader"></div></div>
      {/each}
    {:else}
      {#each items as release (releaseKey(release))}
        {@const key = releaseKey(release)}
        <article data-part="block.item" class="min-w-0">
          <button type="button" data-focusable onclick={() => play(release)} aria-label={`Play ${mediaTitle(release.media)} episode ${release.episode}`}
            class="group relative block aspect-video w-full overflow-hidden rounded-lg bg-muted">
            <img data-part="episode.still" src={releaseStill(release, stills[key])} alt="" loading="lazy" decoding="async" draggable="false"
              class="size-full object-cover transition duration-300 group-hover:scale-105" />
            <span data-part="episode.number" class="absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-black text-white">EP {release.episode}</span>
            {#if playing === key}
              <span class="absolute inset-0 grid place-items-center bg-black/50"><span class="size-7 animate-spin rounded-full border-2 border-white/30 border-t-white"></span></span>
            {/if}
          </button>
          <a data-part="card.title" data-focusable href={mediaHref(release.media)} class="mt-2 line-clamp-1 text-sm font-bold hover:underline">{mediaTitle(release.media)}</a>
          <p data-part="card.meta" class="text-xs text-muted-foreground">Episode {release.episode} · {releasedAgo(release.airingAt, now)}</p>
        </article>
      {/each}
    {/if}
  </div>
  {#if visible && !loading && !items.length && !error}
    <p class="text-sm text-muted-foreground">No episodes to show.</p>
  {/if}
  <Pager {page} {hasNext} {lastPage} mode={block.pagination} {loading} onpage={goTo} />
</section>
