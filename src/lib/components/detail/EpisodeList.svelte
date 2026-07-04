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
  import { fillerEpisodes } from '$lib/anime/filler'
  import { enqueue, enqueueMany, downloads, keyFor } from '$lib/downloads/store'
  import EpisodeCard from './EpisodeCard.svelte'
  import Download from 'lucide-svelte/icons/download'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Pause from 'lucide-svelte/icons/pause'
  import Check from 'lucide-svelte/icons/check'
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
  let metaLoading = $state(true)
  $effect(() => {
    let cancelled = false
    metaLoading = true
    getEpisodeMeta(media.id).then((m) => { if (!cancelled) { meta = m; metaLoading = false } })
    return () => { cancelled = true }
  })

  // Only show per-episode thumbnails when AniZip actually has *distinct* per-ep
  // art. If every episode maps to the same image (or none do), that's series art
  // masquerading as thumbnails — hide it and render text-forward cards instead.
  const showThumbs = $derived.by(() => {
    const imgs = Object.values(meta).map((e) => e.image).filter(Boolean)
    return new Set(imgs).size > 1
  })

  // Filler episodes (AnimeFillerList) — marked in the list.
  let fillerSet = $state<Set<number>>(new Set())
  $effect(() => {
    let cancelled = false
    fillerEpisodes(media.id).then((list) => { if (!cancelled) fillerSet = new Set(list) })
    return () => { cancelled = true }
  })

  let playState = $state<PlayState>({ status: 'idle' })
  const resolving = $derived(playState.status === 'resolving')
  function play(ep: number) { if (!resolving) playEpisode(media, ep, (s) => (playState = s)) }
  function download(ep: number) { enqueue(media, ep) }
  function downloadAired() { enqueueMany(media, Array.from({ length: aired }, (_, i) => i + 1)) }

  function countdown(sec?: number) {
    if (!sec) return ''
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
</script>

{#if total > 0}
  {#if playState.status === 'error'}
    <p class="mb-3 text-sm text-destructive">{playState.message}</p>
  {/if}

  {#if aired > 0}
    <div class="mb-3 flex items-center gap-2">
      <button data-focusable onclick={downloadAired}
              class="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-bold transition-colors hover:bg-accent">
        <Download size={15} /> Download aired ({aired})
      </button>
    </div>
  {/if}

  {#if metaLoading}
    <!-- Immediate skeleton grid (shape matches the setting) so the list appears at
         once and doesn't flip layouts; real cards then fade their thumbnails in. -->
    {#if $episodeLayout === 'cards'}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {#each eps as ep (ep)}
          <div class="overflow-hidden rounded-lg bg-secondary">
            <div class="aspect-video w-full skeloader"></div>
            <div class="p-2"><div class="skeloader h-3.5 w-2/3 rounded"></div></div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {#each eps as ep (ep)}
          <div class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2">
            <div class="skeloader size-8 shrink-0 rounded"></div>
            <div class="skeloader h-3.5 flex-1 rounded"></div>
          </div>
        {/each}
      </div>
    {/if}
  {:else if $episodeLayout === 'cards'}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {#each eps as ep (ep)}
        <EpisodeCard
          {media}
          {ep}
          meta={meta[ep]}
          showThumb={showThumbs && !!meta[ep]?.image}
          released={ep <= aired}
          isNext={next?.episode === ep}
          filler={fillerSet.has(ep)}
          dl={$downloads[keyFor(media.id, ep)]}
          {next}
          onplay={play}
          ondownload={download}
        />
      {/each}
    </div>
  {:else}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
      {#each eps as ep (ep)}
        {@const released = ep <= aired}
        {@const isNext = next?.episode === ep}
        {@const filler = fillerSet.has(ep)}
        {@const dl = $downloads[keyFor(media.id, ep)]}
        <div
          data-focusable
          role="button"
          tabindex="0"
          aria-disabled={!released || resolving}
          onclick={() => released && !resolving && play(ep)}
          onkeydown={(e) => { if (released && !resolving && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(ep) } }}
          title={released ? `Play episode ${ep}${filler ? ' (filler)' : ''}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
          class="group flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors
            {released ? 'cursor-pointer bg-secondary hover:bg-accent' : 'cursor-not-allowed bg-background/40 opacity-60'} {filler ? 'ring-1 ring-yellow-400/70' : ''}"
        >
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded bg-background/40 text-sm font-black">{ep}</span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="truncate text-sm font-bold">{meta[ep]?.title ?? `Episode ${ep}`}</span>
              {#if filler}<span class="shrink-0 rounded bg-yellow-400 px-1 text-[0.6rem] font-bold text-black">FILLER</span>{/if}
              {#if dl?.status === 'done'}<span class="shrink-0 rounded bg-green-500/20 px-1 text-[0.55rem] font-bold text-green-400">SAVED</span>{/if}
            </span>
            {#if isNext}
              <span class="block text-[0.7rem] font-bold text-theme">airing in {countdown(next?.timeUntilAiring)}</span>
            {:else if !released}
              <span class="block text-[0.7rem] text-muted-foreground">Not aired</span>
            {/if}
          </span>
          {#if released}
            <button type="button" data-focusable title="Download" aria-label="Download episode {ep}"
                    onclick={(e) => { e.stopPropagation(); download(ep) }}
                    class="grid size-7 shrink-0 place-items-center rounded-full bg-background/40 text-muted-foreground transition hover:text-foreground
                      {dl ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'}">
              {#if !dl}<Download size={13} />
              {:else if dl.status === 'error'}<Download size={13} class="text-destructive" />
              {:else if dl.status === 'done'}<Check size={13} class="text-green-400" />
              {:else if dl.status === 'downloading'}<span class="text-[0.55rem] font-black tabular-nums">{dl.bytes ? Math.round((dl.downloaded / dl.bytes) * 100) : 0}</span>
              {:else if dl.status === 'queued'}<Loader size={13} class="animate-spin" />
              {:else}<Pause size={12} class="text-amber-400" />{/if}
            </button>
          {/if}
        </div>
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
