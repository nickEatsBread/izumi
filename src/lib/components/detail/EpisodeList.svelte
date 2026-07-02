<script lang="ts">
  // Episode grid. Only *aired* episodes are playable (aired = nextAiringEpisode-1,
  // not the planned total). Upcoming episodes render greyed with an air countdown
  // for the next one. Long-runners (One Piece) are paginated. The layout (rich
  // `cards` vs simple `compact` rows) follows the persisted Appearance setting;
  // per-episode thumbnails/titles/ratings come from AniZip.
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import type { Media } from '$lib/anilist/types'
  import { getEpisodeMeta } from '$lib/anizip'
  import type { EpMeta } from '$lib/anizip/types'
  import { episodeLayout } from '$lib/settings/ui'
  import EpisodeCard from './EpisodeCard.svelte'
  let { media }: { media: Media } = $props()

  const next = $derived(media.nextAiringEpisode)
  // aired = last episode that has already aired.
  const aired = $derived(next?.episode ? Math.max(0, next.episode - 1) : (media.episodes ?? 0))
  // total to show = planned total if known, else up to the next airing episode.
  const total = $derived(media.episodes ?? (next?.episode ?? aired))

  const PER = 48
  let page = $state(0)
  const pages = $derived(Math.max(1, Math.ceil(total / PER)))
  const startIdx = $derived(page * PER)
  const eps = $derived(Array.from({ length: Math.max(0, Math.min(PER, total - startIdx)) }, (_, i) => startIdx + i + 1))

  // Per-episode metadata from AniZip (thumbnail/title/rating). Best-effort; the
  // cards fall back to the show art when a given episode has no entry.
  let meta = $state<Record<number, EpMeta>>({})
  $effect(() => {
    let cancelled = false
    getEpisodeMeta(media.id).then((m) => { if (!cancelled) meta = m })
    return () => { cancelled = true }
  })

  let playState = $state<PlayState>({ status: 'idle' })
  const resolving = $derived(playState.status === 'resolving')
  function play(ep: number) { if (!resolving) playEpisode(media, ep, (s) => (playState = s)) }

  function countdown(sec?: number) {
    if (!sec) return ''
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
</script>

{#if total > 0}
  {#if playState.status === 'resolving'}
    <p class="mb-3 text-sm text-muted-foreground">Resolving stream…</p>
  {:else if playState.status === 'error'}
    <p class="mb-3 text-sm text-destructive">{playState.message}</p>
  {/if}

  {#if $episodeLayout === 'cards'}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {#each eps as ep (ep)}
        <EpisodeCard
          {media}
          {ep}
          meta={meta[ep]}
          released={ep <= aired}
          isNext={next?.episode === ep}
          {next}
          onplay={play}
        />
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
      {#each eps as ep (ep)}
        {@const released = ep <= aired}
        {@const isNext = next?.episode === ep}
        <button
          data-focusable
          disabled={!released || resolving}
          onclick={() => play(ep)}
          title={released ? `Play episode ${ep}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
          class="flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors disabled:cursor-not-allowed
            {released ? 'bg-secondary hover:bg-accent' : 'bg-background/40 opacity-60'}"
        >
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded bg-background/40 text-sm font-black">{ep}</span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-bold">{meta[ep]?.title ?? `Episode ${ep}`}</span>
            {#if isNext}
              <span class="block text-[0.7rem] font-bold text-theme">airing in {countdown(next?.timeUntilAiring)}</span>
            {:else if !released}
              <span class="block text-[0.7rem] text-muted-foreground">Not aired</span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}

  {#if pages > 1}
    <div class="mt-4 flex items-center gap-3 text-sm">
      <button data-focusable disabled={page === 0} onclick={() => (page -= 1)}
              class="rounded bg-secondary px-3 py-1 disabled:opacity-40">Prev</button>
      <span class="text-muted-foreground">Episodes {startIdx + 1}–{startIdx + eps.length} of {total} · page {page + 1}/{pages}</span>
      <button data-focusable disabled={page >= pages - 1} onclick={() => (page += 1)}
              class="rounded bg-secondary px-3 py-1 disabled:opacity-40">Next</button>
    </div>
  {/if}
{:else if next?.episode}
  <p class="text-sm text-muted-foreground">Episode 1 airing in {countdown(next.timeUntilAiring)}</p>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}
