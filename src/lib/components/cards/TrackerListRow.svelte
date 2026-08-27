<script lang="ts">
  import { fetchMediaByIds } from '$lib/anilist/fetch-media'
  import { getKitsuAnimeIds } from '$lib/trackers/kitsu'
  import { getSimklAnimeRefs } from '$lib/trackers/simkl'
  import type { Media } from '$lib/anilist/types'
  import { nearViewport } from '$lib/util/near-viewport'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'

  let { title, tracker, status, showEmpty = false }: {
    title: string
    tracker: 'Kitsu' | 'Simkl'
    status: string
    showEmpty?: boolean
  } = $props()
  let medias = $state<Media[]>([])
  let loading = $state(true)
  let error = $state('')
  let requested = $state(false)
  let sourceUrls = $state(new Map<number, string>())

  function reveal() {
    if (requested) return
    requested = true
    void load()
  }

  async function load() {
    loading = true
    error = ''
    try {
      const refs = tracker === 'Simkl' ? await getSimklAnimeRefs(status, 30) : []
      const ids = tracker === 'Kitsu'
        ? await getKitsuAnimeIds(status, 20)
        : refs.map((item) => item.anilistId)
      sourceUrls = new Map(refs.flatMap((item) => item.simklUrl ? [[item.anilistId, item.simklUrl] as const] : []))
      if (!ids.length) { medias = []; return }
      const mapped = await fetchMediaByIds(ids)
      medias = ids.flatMap((id) => mapped.get(id) ? [mapped.get(id)!] : [])
      if (!medias.length) {
        error = `${tracker} returned titles, but Izumi could not load their card metadata.`
      }
    } catch (cause) {
      console.warn(`${tracker} row`, title, cause)
      error = cause instanceof Error && cause.message.includes('public Simkl Client ID')
        ? cause.message
        : `Could not load your ${tracker} list.`
    } finally { loading = false }
  }
</script>

<div class:deferred-skeleton={!requested} use:nearViewport={{ onEnter: reveal }}>
  {#if loading}
    <Carousel {title}>
      {#each Array.from({ length: 6 }) as _}
        <div class="skeloader aspect-[2/3] w-36 shrink-0 rounded-md sm:w-[152px]"></div>
      {/each}
    </Carousel>
  {:else if error}
    <section class="space-y-2">
      <h2 class="text-lg font-black">{title}</h2>
      <div class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <span class="min-w-0 flex-1">{error}</span>
        <button data-focusable class="shrink-0 rounded-md bg-primary px-3 py-1.5 font-bold text-primary-foreground" onclick={load}>Retry</button>
      </div>
    </section>
  {:else if medias.length}
    <Carousel {title}>
      {#each medias as media (media.id)}
        <SmallCard {media} sourceHref={sourceUrls.get(media.id)} sourceLabel={tracker === 'Simkl' ? 'Simkl' : undefined} />
      {/each}
    </Carousel>
  {:else if showEmpty}
    <section class="mb-6 space-y-2">
      <h3 class="text-base font-black">{title}</h3>
      <p class="rounded-lg border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
        No titles in this list.
      </p>
    </section>
  {/if}
</div>
