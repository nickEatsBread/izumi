<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import EpisodeList from '$lib/components/detail/EpisodeList.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { banner, title, cover, format, status, season, ratingBg, resumeEp, totalEpisodes } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { resumeEpisode, type PlayState } from '$lib/stremio/play'
  import { focusOnMount } from '$lib/nav'
  import { copyToClipboard } from '$lib/util/clipboard'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import { setStatus, toggleFavourite, getMalProgress, setScore } from '$lib/trackers'
  import Heart from 'lucide-svelte/icons/heart'
  import Star from 'lucide-svelte/icons/star'
  import BookmarkPlus from 'lucide-svelte/icons/bookmark-plus'
  import Share2 from 'lucide-svelte/icons/share-2'
  import Clapperboard from 'lucide-svelte/icons/clapperboard'
  import ExternalLink from 'lucide-svelte/icons/external-link'
  import Play from 'lucide-svelte/icons/play'
  import Check from 'lucide-svelte/icons/check'
  import MoreHorizontal from 'lucide-svelte/icons/more-horizontal'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'

  // `id` is a prop (the +page keys this component on it), so navigating anime→relation
  // remounts with the new id and the query re-fetches — a same-route param change alone
  // would NOT re-run a component captured at mount.
  let { id }: { id: number } = $props()

  const client = getContextClient()
  const store = $derived(queryStore<{ Media: Media }>({ client, query: MEDIA_BY_ID, variables: { id } }))

  // MAL read-back: pull the viewer's watched-episode count from MAL and merge it
  // into the AniList media, so progress shows even when the user tracks on MAL
  // (AniList's mediaListEntry is null/0 then). Take whichever tracker is further
  // along. `media` is what the whole page renders — badge, resume, episode marks.
  let malEntry = $state<{ progress: number; status: string; score: number } | null>(null)
  $effect(() => {
    const base = $store.data?.Media
    malEntry = null
    if (base?.idMal) getMalProgress(base.idMal).then((e) => (malEntry = e))
  })
  const media = $derived.by(() => {
    const base = $store.data?.Media
    if (!base) return base
    const malP = malEntry?.progress ?? 0
    if (malP <= (base.mediaListEntry?.progress ?? 0)) return base
    return { ...base, mediaListEntry: { progress: malP, status: base.mediaListEntry?.status ?? malEntry?.status } }
  })

  let active = $state('Episodes')
  let heroPlay = $state<PlayState>({ status: 'idle' })

  // Action-bar transient/optimistic state.
  let fav = $state<boolean | undefined>(undefined)
  let favBusy = $state(false)
  let bookmarked = $state(false)
  let bookmarkBusy = $state(false)
  let copied = $state(false)
  let showTrailer = $state(false)
  let showMore = $state(false)      // mobile action overflow menu
  let descExpanded = $state(false)  // mobile description clamp toggle
  // User rating (canonical 0-100). Optimistic override wins while set; else the AniList list-entry
  // score, else the MAL score (0-10 → 0-100). Displayed as 5 stars (each = 20 / MAL 2 points).
  let scoreOpt = $state<number | undefined>(undefined)
  let scoreBusy = $state(false)
  const userScore = $derived.by(() => {
    if (scoreOpt !== undefined) return scoreOpt
    const ani = $store.data?.Media?.mediaListEntry?.score ?? 0
    return ani > 0 ? ani : (malEntry?.score ?? 0) * 10
  })
  const filledStars = $derived(Math.round(userScore / 20))
  async function onScore(m: Media, value0to100: number) {
    if (!($anilistToken || $malToken) || scoreBusy) return
    scoreBusy = true
    scoreOpt = value0to100 // optimistic; the queue delivers it even if the live push fails
    try { await setScore(m, value0to100) } finally { scoreBusy = false }
  }

  const fmtDate = (d?: { year?: number; month?: number; day?: number } | null) =>
    d?.year ? [d.year, d.month, d.day].filter(Boolean).join('-') : ''

  const stripHtml = (s?: string) => (s ? s.replace(/<[^>]+>/g, '') : '')

  // Total episodes for the badge — schedule-aware so OVAs/ONAs with a null AniList count
  // still show a number (see totalEpisodes).
  const epsTotal = totalEpisodes
  async function onFavourite(m: Media) {
    if (!$anilistToken || favBusy) return
    favBusy = true
    const prev = fav ?? m.isFavourite ?? false
    fav = !prev // optimistic
    try { await toggleFavourite(m); h.success() } catch { fav = prev; h.error() }
    finally { favBusy = false }
  }
  async function onBookmark(m: Media) {
    if (!($anilistToken || $malToken) || bookmarkBusy) return
    bookmarkBusy = true
    try { await setStatus(m, 'PLANNING'); bookmarked = true; h.success() } catch { h.error() }
    finally { bookmarkBusy = false }
  }
  function onShare(m: Media) {
    // navigator.clipboard is absent in the WebKitGTK webview — use the webview-safe helper.
    if (copyToClipboard(`https://anilist.co/anime/${m.id}`)) {
      copied = true
      setTimeout(() => (copied = false), 1500)
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && showMore) showMore = false }} />

{#if $store.fetching}
  <div class="h-[42vh] w-full animate-pulse bg-muted"></div>
{:else if $store.error}
  <div class="p-8 text-muted-foreground">Failed to load: {$store.error.message}</div>
{:else if media}
  {@const m = media}
  {@const isFav = fav ?? m.isFavourite ?? false}
  {@const trackerConnected = !!($anilistToken || $malToken)}
  {#if $isMobile}
    <!-- Mobile: poster-forward header. Own short blurred backdrop (not the 42vh Hero), a portrait
         cover focal, clamped title, pill chips + score, expandable description, a full-width primary
         CTA, and a compact action row (4 icons + overflow menu). -->
    <div class="relative px-4 pb-6">
      <!-- Background art (banner) behind the cover + title, like desktop: visible at the top,
           dissolving into the page before the description so text stays legible. -->
      <div class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 overflow-hidden">
        <img src={banner(m)} alt="" class="h-full w-screen -translate-x-4 object-cover opacity-60" style="object-position:center 20%" />
        <div class="absolute inset-0 bg-gradient-to-b from-background/25 via-background/80 to-background"></div>
      </div>

      <div class="flex gap-4 pt-6">
        <img src={cover(m)} alt="" class="aspect-[2/3] w-32 shrink-0 rounded-lg object-cover shadow-lg" />
        <div class="min-w-0 flex-1 self-end">
          {#if m.title.native || m.title.romaji}
            <div class="truncate text-xs text-muted-foreground">{m.title.native || m.title.romaji}</div>
          {/if}
          <h1 class="line-clamp-2 text-xl font-black leading-tight">{title(m)}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem] font-bold">
            {#if format(m)}<span class="rounded-full bg-secondary px-2 py-0.5">{format(m)}</span>{/if}
            {#if status(m)}<span class="rounded-full bg-secondary px-2 py-0.5">{status(m)}</span>{/if}
            {#if m.averageScore}<span class="rounded-full px-2 py-0.5 text-white {ratingBg(m.averageScore)}">{m.averageScore}%</span>{/if}
          </div>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem] font-bold">
        <span class="rounded-full bg-secondary px-2 py-0.5">{m.mediaListEntry?.progress ?? 0}/{epsTotal(m) || '?'} Episodes</span>
        {#if season(m)}<span class="rounded-full bg-secondary px-2 py-0.5">{season(m)}</span>{/if}
      </div>

      {#if m.description}
        <button type="button" onclick={() => (descExpanded = !descExpanded)}
                class="mt-3 w-full text-left text-sm text-muted-foreground {descExpanded ? 'block' : 'line-clamp-3'}">
          {stripHtml(m.description)}
        </button>
      {/if}

      <!-- Primary CTA -->
      <button data-focusable use:focusOnMount
              onclick={() => { h.impact('medium'); resumeEpisode(m, resumeEp(m), (s) => (heroPlay = s)) }}
              class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-bold text-primary-foreground">
        <Play size={18} />{(m.mediaListEntry?.progress ?? 0) > 0 ? `Continue · Ep ${resumeEp(m)}` : 'Play'}
      </button>

      <!-- Compact action row: 4 icons + overflow. Handlers are the SAME functions the desktop bar uses. -->
      <div class="relative mt-2 flex items-center gap-2">
        <button data-focusable onclick={() => { h.tap(); onBookmark(m) }} disabled={!trackerConnected || bookmarkBusy || bookmarked}
                aria-label="Add to Planning"
                class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary disabled:opacity-40">
          {#if bookmarked}<Check size={18} class="text-theme" />{:else}<BookmarkPlus size={18} />{/if}
        </button>
        <button data-focusable onclick={() => { h.tap(); onFavourite(m) }} disabled={!$anilistToken || favBusy}
                aria-label="Favourite" aria-pressed={isFav}
                class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary disabled:opacity-40">
          <Heart size={18} class={isFav ? 'fill-theme text-theme' : ''} />
        </button>
        <button data-focusable onclick={() => { h.tap(); onShare(m) }} aria-label="Copy link"
                class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
          {#if copied}<Check size={18} class="text-theme" />{:else}<Share2 size={18} />{/if}
        </button>
        {#if m.trailer?.id}
          <button data-focusable onclick={() => { h.tap(); showTrailer = true }} aria-label="Trailer"
                  class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
            <Clapperboard size={18} />
          </button>
        {/if}
        <button data-focusable onclick={() => { h.tap(); showMore = !showMore }} aria-label="More"
                aria-haspopup="true" aria-expanded={showMore}
                class="grid h-11 flex-1 place-items-center rounded-lg bg-secondary">
          <MoreHorizontal size={18} />
        </button>

        {#if showMore}
          <!-- Full-screen backdrop (below the menu) so a tap anywhere else dismisses it, matching
               the trailer dialog's dismissal convention. Escape is handled on <svelte:window>. -->
          <button type="button" aria-label="Close menu" onclick={() => (showMore = false)}
                  class="fixed inset-0 z-10 cursor-default"></button>
          <div class="absolute bottom-full right-0 z-20 mb-2 w-56 rounded-lg border border-border bg-card p-2 shadow-2xl">
            {#if trackerConnected}
              <div class="px-2 pb-1 text-[0.65rem] uppercase text-muted-foreground">Your rating</div>
              <div class="mb-2 flex items-center justify-between px-1" role="group" aria-label="Your rating">
                {#each [1, 2, 3, 4, 5] as n (n)}
                  <button data-focusable onclick={() => { h.select(); onScore(m, userScore === n * 20 ? 0 : n * 20) }} disabled={scoreBusy}
                          aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`} class="grid h-9 w-9 place-items-center rounded-md hover:bg-accent">
                    <Star size={20} class={n <= filledStars ? 'fill-theme text-theme' : 'text-muted-foreground'} />
                  </button>
                {/each}
              </div>
            {/if}
            <button data-focusable onclick={() => { h.tap(); showMore = false; openUrl(`https://anilist.co/anime/${m.id}`) }}
                    class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
              <ExternalLink size={15} /> Open on AniList
            </button>
            {#if m.idMal}
              <button data-focusable onclick={() => { h.tap(); showMore = false; openUrl(`https://myanimelist.net/anime/${m.idMal}`) }}
                      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
                <ExternalLink size={15} /> Open on MyAnimeList
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if heroPlay.status === 'resolving'}
        <p class="mt-3 text-sm text-muted-foreground">Resolving stream…</p>
      {:else if heroPlay.status === 'error'}
        <p class="mt-3 text-sm text-destructive">{heroPlay.message}</p>
      {/if}

      <div class="mt-6">
        <Tabs tabs={['Episodes', 'Relations', 'Details']} bind:active />
        {#if active === 'Episodes'}
          <EpisodeList media={m} />
        {:else if active === 'Relations'}
          {#if m.relations?.edges?.length}
            <div class="mt-3 flex flex-wrap gap-3">
              {#each m.relations.edges as e (e.node.id)}
                <div class="w-28"><SmallCard media={e.node} /></div>
              {/each}
            </div>
          {:else}<p class="mt-3 text-muted-foreground">No related titles.</p>{/if}
        {:else}
          <div class="mt-3 space-y-4">
            {#if m.description}<p class="whitespace-pre-line text-sm text-muted-foreground">{stripHtml(m.description)}</p>{/if}
            <dl class="grid grid-cols-1 gap-2 text-sm">
              {#if m.studios?.nodes?.length}<div><dt class="font-bold">Studios</dt><dd class="text-muted-foreground">{m.studios.nodes.map((s) => s.name).join(', ')}</dd></div>{/if}
              {#if fmtDate(m.startDate)}<div><dt class="font-bold">Start Date</dt><dd class="text-muted-foreground">{fmtDate(m.startDate)}</dd></div>{/if}
              {#if m.synonyms?.length}<div><dt class="font-bold">Synonyms</dt><dd class="text-muted-foreground">{m.synonyms.join(' · ')}</dd></div>{/if}
            </dl>
          </div>
        {/if}
      </div>
    </div>
  {:else}
  <!-- Title-less banner backdrop; the info panel below overlaps its lower fade. -->
  <Hero medias={[m]} showOverlay={false} />
  <div class="relative -mt-[20vh] px-4 pb-16 sm:px-8">
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
          <button data-focusable use:focusOnMount onclick={() => resumeEpisode(m, resumeEp(m), (s) => (heroPlay = s))}
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

          {#if trackerConnected}
            <!-- User rating: 5 stars, each = 20 (AniList 0-100) / 2 (MAL 0-10). Click the current
                 top star to clear. Half-star granularity isn't exposed (Deck/gamepad-friendly). -->
            <div class="ml-1 flex items-center" role="group" aria-label="Your rating">
              {#each [1, 2, 3, 4, 5] as n (n)}
                <button data-focusable onclick={() => onScore(m, userScore === n * 20 ? 0 : n * 20)} disabled={scoreBusy}
                        title={`Rate ${n * 2}/10`} aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                        class="grid h-10 w-6 place-items-center rounded-md transition-colors hover:bg-accent disabled:opacity-40">
                  <Star size={18} class={n <= filledStars ? 'fill-theme text-theme' : 'text-muted-foreground'} />
                </button>
              {/each}
            </div>
          {/if}

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
  {/if}

  {#if showTrailer && m.trailer?.id}
    <div
      role="dialog" aria-modal="true" aria-label="Trailer" tabindex="-1"
      class="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onclick={(e) => { if (e.target === e.currentTarget) showTrailer = false }}
      onkeydown={(e) => e.key === 'Escape' && (showTrailer = false)}
    >
      <div class="aspect-video w-full max-w-4xl">
        <iframe class="h-full w-full rounded-lg" title="Trailer"
                src={`https://www.youtube-nocookie.com/embed/${m.trailer.id}?autoplay=1`}
                allow="autoplay; encrypted-media" allowfullscreen></iframe>
      </div>
      <button data-focusable onclick={() => (showTrailer = false)}
              class="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-md bg-secondary px-3 py-2 text-sm font-bold">Close</button>
    </div>
  {/if}
{:else}
  <div class="p-8 text-muted-foreground">Not found.</div>
{/if}
