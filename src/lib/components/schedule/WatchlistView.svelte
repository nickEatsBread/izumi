<script lang="ts">
  // The Schedule page's Watchlist tab: the viewer's watching list (AniList CURRENT+REPEATING
  // merged with MAL watching), behind-first — shows with aired-but-unwatched episodes on top,
  // caught-up shows dimmed below with a next-episode countdown.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { LIST_QUERY, MEDIA_BY_MAL_QUERY, flattenEntries, type Entry } from '$lib/anilist/lists'
  import { getMalAnimeListMediaOrThrow, type MalListEntry } from '$lib/trackers'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'
  import { title as mediaTitle, cover, mediaHref, totalEpisodes } from '$lib/anilist/media'
  import { until } from '$lib/anilist/schedule'
  import { buildWatchlist, type WatchlistItem } from './watchlist'
  import type { Media } from '$lib/anilist/types'

  const client = getContextClient()
  const listUser = $derived($anilistUserName || $anilistUser)
  const malActive = $derived(!!$malToken || !!$malUser)

  let items = $state<WatchlistItem[]>([])
  let loading = $state(true)

  // Best-effort per source (same policy as loadMySets): a failing tracker just contributes
  // nothing instead of blanking the whole list.
  async function aniEntries(userName: string, status: string): Promise<Entry[]> {
    try {
      const r = await client.query(LIST_QUERY, { userName, status }).toPromise()
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

  onMount(async () => {
    const user = listUser
    const [cur, rep, mal] = await Promise.all([
      user ? aniEntries(user, 'CURRENT') : Promise.resolve([]),
      user ? aniEntries(user, 'REPEATING') : Promise.resolve([]),
      malSide(),
    ])
    items = buildWatchlist([...cur, ...rep], mal.entries, mal.media)
    loading = false
  })

  const pct = (it: WatchlistItem) => {
    const total = totalEpisodes(it.media)
    return total ? Math.min(100, (it.progress / total) * 100) : 0
  }
  const nowSec = () => Math.floor(Date.now() / 1000)
</script>

{#if loading}
  <div class="space-y-2">
    {#each Array.from({ length: 8 }) as _}
      <div class="h-[84px] animate-pulse rounded-lg bg-muted"></div>
    {/each}
  </div>
{:else if !listUser && !malActive}
  <div class="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
    <p class="font-bold text-foreground">No tracker linked</p>
    <p class="mt-1">Link AniList or MyAnimeList in Settings → Trackers to see your watching list here.</p>
  </div>
{:else if !items.length}
  <div class="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
    Nothing in your watching list.
  </div>
{:else}
  <div class="space-y-2">
    {#each items as it (it.media.id)}
      <a data-focusable href={mediaHref(it.media)}
        class="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 transition-colors hover:bg-secondary
          {it.behind === 0 ? 'opacity-70' : ''}">
        <img src={cover(it.media)} alt="" loading="lazy" decoding="async" class="h-16 w-11 shrink-0 rounded bg-muted object-cover" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold">{mediaTitle(it.media)}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{it.progress}/{totalEpisodes(it.media) || '?'}</p>
          <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-primary" style="width: {pct(it)}%"></div>
          </div>
        </div>
        {#if it.behind > 0}
          <span class="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-black text-primary">+{it.behind} new</span>
        {:else if it.media.nextAiringEpisode}
          <span class="shrink-0 text-xs text-muted-foreground">
            Ep {it.media.nextAiringEpisode.episode} {until(nowSec() + it.media.nextAiringEpisode.timeUntilAiring)}
          </span>
        {/if}
      </a>
    {/each}
  </div>
{/if}
