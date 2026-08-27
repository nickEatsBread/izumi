<script lang="ts">
  // The Schedule page's Watchlist tab: the viewer's watching list (AniList CURRENT+REPEATING,
  // MAL watching, and SIMKL watching), behind-first — shows with aired-but-unwatched episodes on top,
  // caught-up shows dimmed below with a next-episode countdown.
  //
  // Presentation is MAL-Sync-style: a toolbar (filter box, sort, layout switch) over three
  // layouts — cover cards with a progress bar and hover quick actions, richer list rows, or
  // dense compact rows. Every row carries Play (resume at the next unwatched episode) and a
  // +1 "watched an episode" bump, the two actions this page exists for.
  import { getContextClient } from '@urql/svelte'
  import { LIST_STATUSES_QUERY, MEDIA_BY_MAL_QUERY, flattenEntries, type Entry } from '$lib/anilist/lists'
  import { fetchMediaByIds } from '$lib/anilist/fetch-media'
  import { getMalAnimeListMediaOrThrow, updateProgress, type MalListEntry } from '$lib/trackers'
  import { getSimklAnimeListEntries } from '$lib/trackers/simkl'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser, simklToken } from '$lib/trackers/config'
  import { title as mediaTitle, cardCover, mediaHref, resumeEp, totalEpisodes } from '$lib/anilist/media'
  import { until } from '$lib/anilist/schedule'
  import { buildWatchlist, type WatchlistItem } from './watchlist'
  import type { Media } from '$lib/anilist/types'
  import type { PlayState } from '$lib/stremio/play'
  import { watchlistLayout, watchlistSort, type WatchlistLayout, type WatchlistSort } from '$lib/settings/ui'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import Search from '@lucide/svelte/icons/search'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Rows3 from '@lucide/svelte/icons/rows-3'
  import List from '@lucide/svelte/icons/list'
  import Play from '@lucide/svelte/icons/play'
  import Plus from '@lucide/svelte/icons/plus'
  import Loader from '@lucide/svelte/icons/loader-circle'

  const client = getContextClient()
  const listUser = $derived($anilistUserName || $anilistUser)
  const malActive = $derived(!!$malToken || !!$malUser)
  const simklActive = $derived(!!$simklToken)

  let items = $state<WatchlistItem[]>([])
  let loading = $state(true)

  // Best-effort per source (same policy as loadMySets): a failing tracker just contributes
  // nothing instead of blanking the whole list.
  async function aniEntries(userName: string): Promise<Entry[]> {
    try {
      const r = await client.query(LIST_STATUSES_QUERY, {
        userName, statuses: ['CURRENT', 'REPEATING'],
      }).toPromise()
      return r.error ? [] : flattenEntries(r.data)
    }
    catch { return [] }
  }

  async function malSide(): Promise<{ entries: MalListEntry[]; media: Media[] }> {
    try {
      const list = await getMalAnimeListMediaOrThrow('watching', 100)
      // MAL's list payload knows the planned total but carries no next-airing episode or schedule.
      // Enrich all rows in one AniList request so "new" means aired-and-unwatched, as it does in
      // MALSync. If AniList is unavailable, retain MAL's cards; airedCount's status-aware fallback
      // refuses to turn their planned totals into false new-episode badges.
      const ids = list.flatMap((entry) => entry.media.idMal == null ? [] : [entry.media.idMal])
      let enriched: Media[] = []
      if (ids.length) {
        const result = await client.query(MEDIA_BY_MAL_QUERY, { ids }).toPromise()
        if (!result.error) enriched = (result.data as { Page?: { media?: Media[] } })?.Page?.media ?? []
      }
      const enrichedByMal = new Map(enriched.map((media) => [media.idMal, media]))
      return {
        entries: list.flatMap((entry) => entry.media.idMal == null ? [] : [{
          idMal: entry.media.idMal,
          progress: entry.progress,
          updatedAt: entry.updatedAt,
        }]),
        media: list.map((entry) => enrichedByMal.get(entry.media.idMal) ?? entry.media),
      }
    }
    catch { return { entries: [], media: [] } }
  }

  async function simklSide(): Promise<Entry[]> {
    try {
      const list = await getSimklAnimeListEntries('watching', 100)
      if (!list.length) return []
      // SIMKL supplies user state and cross-database IDs, not the catalogue cards. Resolve those
      // IDs through Izumi's normal anime catalogue path and keep the resulting cards unlabelled.
      const media = await fetchMediaByIds(list.map((entry) => entry.anilistId))
      return list.flatMap((entry) => {
        const matched = media.get(entry.anilistId)
        return matched ? [{ media: matched, progress: entry.progress, updatedAt: entry.updatedAt }] : []
      })
    }
    catch { return [] }
  }

  $effect(() => {
    const user = listUser
    const useSimkl = simklActive
    let cancelled = false
    loading = true
    void Promise.all([
      user ? aniEntries(user) : Promise.resolve([]),
      malSide(),
      useSimkl ? simklSide() : Promise.resolve([]),
    ]).then(([ani, mal, simkl]) => {
      if (cancelled) return
      items = buildWatchlist([...ani, ...simkl], mal.entries, mal.media)
      loading = false
    })
    return () => { cancelled = true }
  })

  // ── Toolbar: filter + sort + layout ────────────────────────────────────────

  let query = $state('')
  const SORTS: { value: WatchlistSort; label: string }[] = [
    { value: 'behind', label: 'New episodes first' },
    { value: 'updated', label: 'Recently updated' },
    { value: 'next', label: 'Next airing' },
    { value: 'title', label: 'Title A–Z' },
  ]
  const LAYOUTS: { value: WatchlistLayout; label: string; icon: typeof LayoutGrid }[] = [
    { value: 'cards', label: 'Cards', icon: LayoutGrid },
    { value: 'list', label: 'List', icon: Rows3 },
    { value: 'compact', label: 'Compact', icon: List },
  ]

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const matches = q
      ? items.filter((it) =>
          [it.media.title.romaji, it.media.title.english, it.media.title.userPreferred]
            .some((t) => t?.toLowerCase().includes(q)))
      : items
    // `behind` is buildWatchlist's own order — no re-sort, so the tuned tie-breaks survive.
    switch ($watchlistSort) {
      case 'updated': return [...matches].sort((a, b) => b.updatedAt - a.updatedAt)
      case 'next': return [...matches].sort((a, b) =>
        (a.media.nextAiringEpisode?.timeUntilAiring ?? Infinity) - (b.media.nextAiringEpisode?.timeUntilAiring ?? Infinity)
        || b.updatedAt - a.updatedAt)
      case 'title': return [...matches].sort((a, b) => mediaTitle(a.media).localeCompare(mediaTitle(b.media)))
      default: return matches
    }
  })

  function setLayout(layout: WatchlistLayout) {
    if ($watchlistLayout === layout) return
    h.select()
    watchlistLayout.set(layout)
  }

  // ── Quick actions ──────────────────────────────────────────────────────────

  let resolvingId = $state<number | null>(null)
  let playError = $state('')
  const loadPlayback = () => import('$lib/stremio/play')
  async function play(it: WatchlistItem) {
    if (resolvingId != null) return
    h.tap()
    playError = ''
    resolvingId = it.media.id
    try {
      const { resumeEpisode } = await loadPlayback()
      await resumeEpisode(it.media, resumeEp(it.media, it.progress), (s: PlayState) => {
        if (s.status !== 'resolving') resolvingId = null
        if (s.status === 'error') playError = s.message ?? 'No source was found.'
      })
    } catch { resolvingId = null }
  }

  // MAL-Sync's signature +1: bump the tracked episode count straight from the list. Optimistic —
  // updateProgress is best-effort (queues + retries on its own), so the row moves immediately.
  function bump(it: WatchlistItem) {
    const total = totalEpisodes(it.media)
    if (total && it.progress >= total) return
    h.select()
    it.progress += 1
    it.behind = Math.max(0, it.behind - 1)
    void updateProgress(it.media, it.progress, 'CURRENT')
  }

  const pct = (it: WatchlistItem) => {
    const total = totalEpisodes(it.media)
    return total ? Math.min(100, (it.progress / total) * 100) : 0
  }
  const nowSec = () => Math.floor(Date.now() / 1000)
  const nextAiring = (it: WatchlistItem) => it.media.nextAiringEpisode
    ? `Ep ${it.media.nextAiringEpisode.episode} ${until(nowSec() + it.media.nextAiringEpisode.timeUntilAiring)}`
    : ''
</script>

{#if loading}
  {#if $watchlistLayout === 'cards'}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
      {#each Array.from({ length: 12 }) as _}
        <div class="skeloader aspect-[2/3] rounded-lg"></div>
      {/each}
    </div>
  {:else}
    <div class="space-y-2">
      {#each Array.from({ length: 8 }) as _}
        <div class="skeloader {$watchlistLayout === 'compact' ? 'h-11' : 'h-[84px]'} rounded-lg"></div>
      {/each}
    </div>
  {/if}
{:else if !listUser && !malActive && !simklActive}
  <div class="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
    <p class="font-bold text-foreground">No tracker linked</p>
    <p class="mt-1">Link AniList, MyAnimeList, or Simkl in Settings → Accounts to see your watching list here.</p>
  </div>
{:else if !items.length}
  <div class="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
    Nothing in your watching list.
  </div>
{:else}
  <!-- Toolbar: filter + sort + layout, one wrapping row like the episode controls. -->
  <div class="mb-4 flex flex-wrap items-center gap-2">
    <label class="relative min-w-0 flex-1 basis-48">
      <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input bind:value={query} data-focusable placeholder="Filter your shows…"
             class="h-11 w-full rounded-xl bg-input pl-10 pr-3 text-base sm:h-9 sm:rounded-md sm:pl-9 sm:text-sm" />
    </label>
    <select bind:value={$watchlistSort} data-focusable aria-label="Sort watchlist"
            class="h-11 rounded-xl bg-secondary px-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-accent sm:h-9 sm:rounded-md sm:text-xs">
      {#each SORTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
    </select>
    <div role="group" aria-label="Watchlist layout"
         class="flex h-11 items-stretch rounded-xl bg-secondary p-1 sm:h-9 sm:rounded-md sm:p-0.5">
      {#each LAYOUTS as l (l.value)}
        <button data-focusable onclick={() => setLayout(l.value)} aria-label={l.label}
                aria-pressed={$watchlistLayout === l.value}
                class="grid w-10 place-items-center rounded-lg transition-colors sm:w-9 sm:rounded
                  {$watchlistLayout === l.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
          <l.icon size={16} />
        </button>
      {/each}
    </div>
  </div>
  {#if playError}<p class="mb-3 text-sm text-destructive">{playError}</p>{/if}
  {#if !visible.length}
    <p class="py-6 text-center text-sm text-muted-foreground">No shows match “{query.trim()}”.</p>
  {:else if $watchlistLayout === 'cards'}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
      {#each visible as it (it.media.id)}
        <div class="group relative">
          <a href={mediaHref(it.media)} data-focusable onclick={() => h.tap()} class="block">
            <div class="focus-cover relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
              <img src={cardCover(it.media)} alt={mediaTitle(it.media)} loading="lazy" decoding="async"
                   class="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105" />
              {#if it.behind > 0}
                <span class="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[0.62rem] font-black uppercase tracking-wide text-primary-foreground shadow-lg">
                  +{it.behind} new
                </span>
              {/if}
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2 pb-1.5 pt-6">
                <p class="line-clamp-2 text-[0.72rem] font-black leading-tight text-white">{mediaTitle(it.media)}</p>
                <div class="mt-1 flex items-center gap-1.5">
                  <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/25">
                    <div class="h-full rounded-full bg-primary transition-[width] duration-300" style="width: {pct(it)}%"></div>
                  </div>
                  <span class="shrink-0 text-[0.62rem] font-bold tabular-nums text-white/85">{it.progress}/{totalEpisodes(it.media) || '?'}</span>
                </div>
              </div>
            </div>
          </a>
          <!-- Quick actions: hover on desktop, focus-within covers controller nav (the gamemode
               CSS gate re-enables group-focus-within), always visible on touch. -->
          <div class="absolute right-1.5 top-1.5 flex gap-1
            {$isMobile ? '' : 'opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100'}">
            <button data-focusable onclick={() => play(it)} aria-label="Play episode {resumeEp(it.media, it.progress)}"
                    class="grid size-8 place-items-center rounded-full bg-black/70 text-white shadow-lg transition-colors hover:bg-primary">
              {#if resolvingId === it.media.id}<Loader size={14} class="animate-spin" />
              {:else}<Play size={14} class="translate-x-px fill-current" />{/if}
            </button>
            <button data-focusable onclick={() => bump(it)} aria-label="Mark episode {it.progress + 1} watched"
                    class="grid size-8 place-items-center rounded-full bg-black/70 text-white shadow-lg transition-colors hover:bg-primary">
              <Plus size={15} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else if $watchlistLayout === 'list'}
    <div class="space-y-2">
      {#each visible as it (it.media.id)}
        <div class="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 transition-colors hover:bg-secondary
                    {it.behind === 0 ? 'opacity-70' : ''}">
          <a href={mediaHref(it.media)} data-focusable onclick={() => h.tap()} class="flex min-w-0 flex-1 items-center gap-3">
            <img src={cardCover(it.media, 56)} alt="" loading="lazy" decoding="async"
                 class="h-16 w-11 shrink-0 rounded bg-muted object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{mediaTitle(it.media)}</p>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">
                {it.progress}/{totalEpisodes(it.media) || '?'}
                {#if it.behind === 0 && nextAiring(it)} · {nextAiring(it)}{/if}
              </p>
              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-[width] duration-300" style="width: {pct(it)}%"></div>
              </div>
            </div>
          </a>
          {#if it.behind > 0}
            <span class="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-black text-primary">+{it.behind} new</span>
          {/if}
          <div class="flex shrink-0 gap-1">
            <button data-focusable onclick={() => play(it)} aria-label="Play episode {resumeEp(it.media, it.progress)}"
                    class="grid size-9 place-items-center rounded-md bg-secondary text-foreground/85 transition-colors hover:bg-accent">
              {#if resolvingId === it.media.id}<Loader size={15} class="animate-spin" />
              {:else}<Play size={15} class="translate-x-px fill-current" />{/if}
            </button>
            <button data-focusable onclick={() => bump(it)} aria-label="Mark episode {it.progress + 1} watched"
                    class="grid size-9 place-items-center rounded-md bg-secondary text-foreground/85 transition-colors hover:bg-accent">
              <Plus size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="space-y-1">
      {#each visible as it (it.media.id)}
        <div class="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-secondary
                    {it.behind === 0 ? 'opacity-70' : ''}">
          <a href={mediaHref(it.media)} data-focusable onclick={() => h.tap()} class="flex min-w-0 flex-1 items-center gap-2.5">
            <img src={cardCover(it.media, 40)} alt="" loading="lazy" decoding="async"
                 class="h-9 w-6 shrink-0 rounded-sm bg-muted object-cover" />
            <span class="min-w-0 flex-1 truncate text-sm font-bold">{mediaTitle(it.media)}</span>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{it.progress}/{totalEpisodes(it.media) || '?'}</span>
          </a>
          {#if it.behind > 0}
            <span class="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[0.65rem] font-black text-primary">+{it.behind}</span>
          {:else if nextAiring(it)}
            <span class="hidden shrink-0 text-[0.65rem] text-muted-foreground sm:inline">{nextAiring(it)}</span>
          {/if}
          <button data-focusable onclick={() => bump(it)} aria-label="Mark episode {it.progress + 1} watched"
                  class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Plus size={15} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
{/if}
