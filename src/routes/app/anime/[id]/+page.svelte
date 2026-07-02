<script lang="ts">
  import { page } from '$app/state'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import EpisodeList from '$lib/components/detail/EpisodeList.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { title, cover, format, status, season, ratingBg } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import { setStatus, toggleFavourite } from '$lib/trackers'
  import Heart from 'lucide-svelte/icons/heart'
  import BookmarkPlus from 'lucide-svelte/icons/bookmark-plus'
  import Share2 from 'lucide-svelte/icons/share-2'
  import Clapperboard from 'lucide-svelte/icons/clapperboard'
  import ExternalLink from 'lucide-svelte/icons/external-link'
  import Play from 'lucide-svelte/icons/play'
  import Check from 'lucide-svelte/icons/check'

  const client = getContextClient()
  const id = Number(page.params.id)
  const store = queryStore<{ Media: Media }>({ client, query: MEDIA_BY_ID, variables: { id } })
  let active = $state('Episodes')
  let heroPlay = $state<PlayState>({ status: 'idle' })

  // Action-bar transient/optimistic state.
  let fav = $state<boolean | undefined>(undefined)
  let favBusy = $state(false)
  let bookmarked = $state(false)
  let bookmarkBusy = $state(false)
  let copied = $state(false)
  let showTrailer = $state(false)

  const fmtDate = (d?: { year?: number; month?: number; day?: number } | null) =>
    d?.year ? [d.year, d.month, d.day].filter(Boolean).join('-') : ''

  const stripHtml = (s?: string) => (s ? s.replace(/<[^>]+>/g, '') : '')

  // Total episodes for the badge: planned total, else aired (nextAiring-1).
  function epsTotal(m: Media) {
    return m.episodes ?? (m.nextAiringEpisode?.episode ? m.nextAiringEpisode.episode - 1 : 0)
  }
  // Resume episode: next unwatched, capped to what's aired (fallback 1).
  function resumeEp(m: Media) {
    const aired = m.nextAiringEpisode?.episode ? m.nextAiringEpisode.episode - 1 : (m.episodes ?? Infinity)
    const nextUp = (m.mediaListEntry?.progress ?? 0) + 1
    return Math.max(1, Math.min(nextUp, aired || 1))
  }

  async function onFavourite(m: Media) {
    if (!$anilistToken || favBusy) return
    favBusy = true
    const prev = fav ?? m.isFavourite ?? false
    fav = !prev // optimistic
    try { await toggleFavourite(m) } catch { fav = prev }
    finally { favBusy = false }
  }
  async function onBookmark(m: Media) {
    if (!($anilistToken || $malToken) || bookmarkBusy) return
    bookmarkBusy = true
    try { await setStatus(m, 'PLANNING'); bookmarked = true } catch { /* ignore */ }
    finally { bookmarkBusy = false }
  }
  async function onShare(m: Media) {
    try {
      await navigator.clipboard.writeText(`https://anilist.co/anime/${m.id}`)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch { /* ignore */ }
  }
</script>

{#if $store.fetching}
  <div class="h-[42vh] w-full animate-pulse bg-muted"></div>
{:else if $store.error}
  <div class="p-8 text-muted-foreground">Failed to load: {$store.error.message}</div>
{:else if $store.data?.Media}
  {@const m = $store.data.Media}
  {@const isFav = fav ?? m.isFavourite ?? false}
  {@const trackerConnected = !!($anilistToken || $malToken)}
  <!-- Title-less banner backdrop; the info panel below overlaps its lower fade. -->
  <Hero medias={[m]} showOverlay={false} />
  <div class="relative px-8 pb-16 -mt-[20vh]">
    {#if heroPlay.status === 'resolving'}
      <p class="mb-3 text-sm text-muted-foreground">Resolving stream…</p>
    {:else if heroPlay.status === 'error'}
      <p class="mb-3 text-sm text-destructive">{heroPlay.message}</p>
    {/if}

    <!-- Hero info panel: cover + title/badges/description + action bar. -->
    <div class="mb-6 flex flex-col gap-6 md:flex-row">
      <img src={cover(m)} alt="" class="h-auto w-40 shrink-0 self-start rounded-lg shadow-lg md:w-52" />

      <div class="min-w-0 flex-1">
        {#if m.title.native || m.title.romaji}
          <div class="text-sm text-muted-foreground">{m.title.native || m.title.romaji}</div>
        {/if}
        <h1 class="mb-3 text-3xl font-black">{title(m)}</h1>

        <div class="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold">
          <span class="rounded-full bg-secondary px-3 py-1">{m.mediaListEntry?.progress ?? 0}/{epsTotal(m) || '?'} Episodes</span>
          {#if format(m)}<span class="rounded-full bg-secondary px-3 py-1">{format(m)}</span>{/if}
          {#if status(m)}<span class="rounded-full bg-secondary px-3 py-1">{status(m)}</span>{/if}
          {#if season(m)}<span class="rounded-full bg-secondary px-3 py-1">{season(m)}</span>{/if}
          {#if m.averageScore}<span class="rounded-full px-3 py-1 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>{/if}
        </div>

        {#if m.description}
          <p class="mb-4 line-clamp-4 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}

        {#if m.genres?.length}
          <div class="mb-4 flex flex-wrap gap-2">
            {#each m.genres as g (g)}<span class="rounded-full bg-secondary px-3 py-1 text-xs">{g}</span>{/each}
          </div>
        {/if}

        <!-- Action bar -->
        <div class="flex flex-wrap items-center gap-2">
          <button data-focusable onclick={() => playEpisode(m, resumeEp(m), (s) => (heroPlay = s))}
                  class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">
            <Play size={16} />{(m.mediaListEntry?.progress ?? 0) > 0 ? `Continue · Ep ${resumeEp(m)}` : 'Play'}
          </button>

          <button data-focusable onclick={() => onFavourite(m)} disabled={!$anilistToken || favBusy}
                  title={$anilistToken ? (isFav ? 'Unfavourite' : 'Favourite') : 'Connect AniList'}
                  aria-pressed={isFav}
                  class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
            <Heart size={18} class={isFav ? 'fill-theme text-theme' : ''} />
          </button>

          <button data-focusable onclick={() => onBookmark(m)} disabled={!trackerConnected || bookmarkBusy || bookmarked}
                  title={trackerConnected ? (bookmarked ? 'Added to Planning' : 'Add to Planning') : 'Connect a tracker'}
                  class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
            {#if bookmarked}<Check size={18} class="text-theme" />{:else}<BookmarkPlus size={18} />{/if}
          </button>

          <button data-focusable onclick={() => onShare(m)} title="Copy AniList link"
                  class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
            {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
          </button>

          {#if m.trailer?.id}
            <button data-focusable onclick={() => (showTrailer = true)} title="Watch trailer"
                    class="grid h-10 w-10 place-items-center rounded-md bg-secondary transition-colors hover:bg-accent">
              <Clapperboard size={18} />
            </button>
          {/if}

          <button data-focusable onclick={() => openUrl(`https://anilist.co/anime/${m.id}`)} title="Open on AniList"
                  class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
            AniList<ExternalLink size={14} />
          </button>

          {#if m.idMal}
            <button data-focusable onclick={() => openUrl(`https://myanimelist.net/anime/${m.idMal}`)} title="Open on MyAnimeList"
                    class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
              MAL<ExternalLink size={14} />
            </button>
          {/if}
        </div>
      </div>
    </div>

    <Tabs tabs={['Episodes', 'Relations', 'Details']} bind:active />
    {#if active === 'Episodes'}
      <EpisodeList media={m} />
    {:else if active === 'Relations'}
      {#if m.relations?.edges?.length}
        <div class="flex flex-wrap gap-4">
          {#each m.relations.edges as e (e.node.id)}
            <div class="w-[152px]">
              <div class="mb-1 text-[0.65rem] uppercase text-muted-foreground">{e.relationType.replaceAll('_', ' ').toLowerCase()}</div>
              <SmallCard media={e.node} />
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted-foreground">No related titles.</p>
      {/if}
    {:else}
      <div class="max-w-3xl space-y-4">
        {#if m.description}
          <p class="whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>
        {/if}
        <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {#if m.studios?.nodes?.length}
            <div><dt class="font-bold">Studios</dt><dd class="text-muted-foreground">{m.studios.nodes.map((s) => s.name).join(', ')}</dd></div>
          {/if}
          {#if fmtDate(m.startDate)}
            <div><dt class="font-bold">Start Date</dt><dd class="text-muted-foreground">{fmtDate(m.startDate)}</dd></div>
          {/if}
          {#if m.synonyms?.length}
            <div class="sm:col-span-2"><dt class="font-bold">Synonyms</dt><dd class="text-muted-foreground">{m.synonyms.join(' · ')}</dd></div>
          {/if}
        </dl>
      </div>
    {/if}
  </div>

  {#if showTrailer && m.trailer?.id}
    <div
      role="dialog" aria-modal="true" aria-label="Trailer" tabindex="-1"
      class="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onclick={() => (showTrailer = false)}
      onkeydown={(e) => e.key === 'Escape' && (showTrailer = false)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="aspect-video w-full max-w-4xl" onclick={(e) => e.stopPropagation()}>
        <iframe class="h-full w-full rounded-lg" title="Trailer"
                src={`https://www.youtube-nocookie.com/embed/${m.trailer.id}?autoplay=1`}
                allow="autoplay; encrypted-media" allowfullscreen></iframe>
      </div>
      <button data-focusable onclick={() => (showTrailer = false)}
              class="absolute right-4 top-4 rounded-md bg-secondary px-3 py-2 text-sm font-bold">Close</button>
    </div>
  {/if}
{:else}
  <div class="p-8 text-muted-foreground">Not found.</div>
{/if}
