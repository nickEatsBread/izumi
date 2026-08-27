<script lang="ts">
  // The viewer's personal library — connected tracker lists by status, plus the unified
  // resume row. Reachable from the customizable nav (Settings → Navigation → My List).
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import TrackerListRow from '$lib/components/cards/TrackerListRow.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, kitsuToken, malToken, malUser, simklToken } from '$lib/trackers/config'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'

  // No shared hero banner on this page.
  heroMedia.set(null)
  const listUser = $derived($anilistUserName || $anilistUser)
  let section = $state<'anime' | 'manga' | 'novel'>('anime')
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Your List is unavailable offline" subtitle="Your tracker lists need a connection. Downloaded titles are available on the Downloads page." />
{:else}
<div class="p-4 pb-16 sm:p-8">
  <h1 class="mb-4 text-2xl font-black">My List</h1>

  {#if listUser || $malToken || $malUser || $kitsuToken || $simklToken}
    <div class="mb-6 inline-flex rounded-lg bg-secondary p-1 text-sm font-black">
      <button data-focusable onclick={() => (section = 'anime')}
        class="rounded-md px-4 py-2 transition-colors {section === 'anime' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        Anime
      </button>
      {#if listUser || $malToken || $malUser}
      <button data-focusable onclick={() => (section = 'manga')}
        class="rounded-md px-4 py-2 transition-colors {section === 'manga' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        Manga
      </button>
      <button data-focusable onclick={() => (section = 'novel')}
        class="rounded-md px-4 py-2 transition-colors {section === 'novel' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        Novels
      </button>
      {/if}
    </div>

    {#key section}
      {#if section === 'anime'}
        <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
        {#if listUser}
          <ListRow title="Watching" userName={listUser} status="CURRENT" />
          <ListRow title="Rewatching" userName={listUser} status="REPEATING" />
          <ListRow title="Planning" userName={listUser} status="PLANNING" />
          <ListRow title="Completed" userName={listUser} status="COMPLETED" />
          <ListRow title="Paused" userName={listUser} status="PAUSED" />
          <ListRow title="Dropped" userName={listUser} status="DROPPED" />
        {/if}
        {#if $malToken || $malUser}
          <MalListRow title="Watching (MAL)" status="watching" />
          <MalListRow title="Plan to Watch (MAL)" status="plan_to_watch" />
          <MalListRow title="Completed (MAL)" status="completed" />
          <MalListRow title="On Hold (MAL)" status="on_hold" />
          <MalListRow title="Dropped (MAL)" status="dropped" />
        {/if}
        {#if $kitsuToken}
          <TrackerListRow title="Watching (Kitsu)" tracker="Kitsu" status="current" />
          <TrackerListRow title="Planning (Kitsu)" tracker="Kitsu" status="planned" />
          <TrackerListRow title="Completed (Kitsu)" tracker="Kitsu" status="completed" />
          <TrackerListRow title="On Hold (Kitsu)" tracker="Kitsu" status="on_hold" />
          <TrackerListRow title="Dropped (Kitsu)" tracker="Kitsu" status="dropped" />
        {/if}
        {#if $simklToken}
          <section class="mt-8 border-t border-border/70 pt-6" aria-labelledby="simkl-library-heading">
            <div class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="simkl-library-heading" class="text-xl font-black">Simkl Library</h2>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-black text-emerald-300">
                <span class="size-1.5 rounded-full bg-emerald-400"></span>
                Connected
              </span>
              <p class="w-full text-xs text-muted-foreground">Watchlist status and progress synced from Simkl.</p>
            </div>
            <TrackerListRow title="Watching" tracker="Simkl" status="watching" showEmpty />
            <TrackerListRow title="Plan to Watch" tracker="Simkl" status="plantowatch" />
            <TrackerListRow title="Completed" tracker="Simkl" status="completed" />
            <TrackerListRow title="On Hold" tracker="Simkl" status="hold" />
            <TrackerListRow title="Dropped" tracker="Simkl" status="dropped" />
          </section>
        {/if}
      {:else}
        <p class="mb-5 max-w-2xl text-sm text-muted-foreground">
          Information only. Izumi can show titles from your tracker, but remains an anime player and does not provide reading or downloads.
        </p>
        {#if listUser}
          <ListRow title="Reading" userName={listUser} status="CURRENT" kind={section} />
          <ListRow title="Rereading" userName={listUser} status="REPEATING" kind={section} />
          <ListRow title="Planning" userName={listUser} status="PLANNING" kind={section} />
          <ListRow title="Completed" userName={listUser} status="COMPLETED" kind={section} />
          <ListRow title="Paused" userName={listUser} status="PAUSED" kind={section} />
          <ListRow title="Dropped" userName={listUser} status="DROPPED" kind={section} />
        {/if}
        {#if $malToken || $malUser}
          <MalListRow title="Reading (MAL)" status="reading" kind={section} />
          <MalListRow title="Plan to Read (MAL)" status="plan_to_read" kind={section} />
          <MalListRow title="Completed (MAL)" status="completed" kind={section} />
          <MalListRow title="On Hold (MAL)" status="on_hold" kind={section} />
          <MalListRow title="Dropped (MAL)" status="dropped" kind={section} />
        {/if}
      {/if}
    {/key}
  {:else}
    <div class="grid min-h-[50vh] place-items-center text-center">
      <div class="max-w-sm">
        <p class="mb-4 text-sm text-muted-foreground">Connect AniList, MyAnimeList, Kitsu, or Simkl to see your library here.</p>
        <a href="/app/settings/accounts" data-focusable
           class="rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Connect an account</a>
      </div>
    </div>
  {/if}
</div>
{/if}
