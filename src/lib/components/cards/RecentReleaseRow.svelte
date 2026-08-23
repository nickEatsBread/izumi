<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { RECENT_RELEASES_QUERY } from '$lib/anilist/queries'
  import type { Media } from '$lib/anilist/types'
  import { gameMode } from '$lib/player/session'
  import { dismissedRecentReleaseIds, showAdult } from '$lib/settings/ui'
  import { releasedAgo } from '$lib/anime/airing-labels'
  import * as h from '$lib/haptics'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import { nearViewport } from '$lib/util/near-viewport'

  type Release = { episode: number; airingAt: number; media: Media }

  const client = getContextClient()
  const before = Math.floor(Date.now() / 1000) + 60
  const after = before - 21 * 86_400
  let visible = $state(false)
  const reveal = () => { visible = true }
  let now = $state(Date.now())
  let activeId = $state<number | null>(null)
  const active = $derived(visible || $gameMode)
  const store = $derived(queryStore<{ Page: { airingSchedules: Release[] } }>({
    client,
    query: RECENT_RELEASES_QUERY,
    variables: { perPage: 50, after, before },
    pause: !active,
  }))

  // Latest episode per title. Multi-episode drops otherwise repeat the same cover several times and
  // make the row harder to scan than the "recently updated" rows used by dedicated anime clients.
  const releases = $derived.by(() => {
    const seen = new Set<number>()
    const dismissed = new Set($dismissedRecentReleaseIds)
    const out: Release[] = []
    for (const release of $store.data?.Page.airingSchedules ?? []) {
      if (!release.media || dismissed.has(release.media.id) || seen.has(release.media.id) || (!$showAdult && release.media.isAdult)) continue
      seen.add(release.media.id)
      out.push(release)
      if (out.length >= 20) break
    }
    return out
  })

  async function dismiss(mediaId: number) {
    const index = releases.findIndex((release) => release.media.id === mediaId)
    if (index < 0) return
    const next = releases[index + 1] ?? releases[index - 1]
    const restoreFocus = document.activeElement?.closest(`[data-recent-id="${mediaId}"]`) != null
    h.warn()
    dismissedRecentReleaseIds.update((ids) => [mediaId, ...ids.filter((id) => id !== mediaId)].slice(0, 200))
    activeId = null
    if (!restoreFocus || !next) return
    await tick()
    activeId = next.media.id
    document.querySelector<HTMLElement>(`[data-recent-id="${next.media.id}"] [data-focusable]`)?.focus()
  }

  function onKey(e: KeyboardEvent) {
    if ((e.key !== 'd' && e.key !== 'D') || e.repeat || e.ctrlKey || e.metaKey || e.altKey || activeId == null) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    e.preventDefault()
    void dismiss(activeId)
  }

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
</script>

<svelte:window onkeydown={onKey} />

<div use:nearViewport={{ onEnter: reveal }}>
  {#if !active || $store.fetching || releases.length > 0}
    <Carousel title="Recently Released" viewMoreHref="/app/schedule">
      {#if !active || $store.fetching}
        {#each Array.from({ length: 8 }) as _}
          <div class="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-muted sm:w-[152px]"></div>
        {/each}
      {:else}
        {#each releases as release (`${release.media.id}-${release.episode}-${release.airingAt}`)}
          <div class="load-in shrink-0" data-recent-id={release.media.id} role="group"
               onmouseenter={() => (activeId = release.media.id)}
               onmouseleave={() => { if (activeId === release.media.id) activeId = null }}
               onfocusin={() => (activeId = release.media.id)}
               onfocusout={() => { if (activeId === release.media.id) activeId = null }}>
            <SmallCard media={release.media} badge={`Episode ${release.episode}`} subline={releasedAgo(release.airingAt, now)} simpleHover />
          </div>
        {/each}
      {/if}
    </Carousel>
  {/if}
</div>
