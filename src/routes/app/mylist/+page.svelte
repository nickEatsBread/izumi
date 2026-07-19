<script lang="ts">
  // The viewer's personal library — AniList and/or MyAnimeList lists by status, plus the unified
  // resume row. Reachable from the customizable nav (Settings → Navigation → My List).
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken } from '$lib/trackers/config'
  import { heroMedia } from '$lib/stores/hero'

  // No shared hero banner on this page.
  heroMedia.set(null)
  const listUser = $derived($anilistUserName || $anilistUser)
</script>

<div class="p-4 pb-16 sm:p-8">
  <h1 class="mb-4 text-2xl font-black">My List</h1>

  {#if listUser || $malToken}
    <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken} />
    {#if listUser}
      <ListRow title="Watching" userName={listUser} status="CURRENT" />
      <ListRow title="Planning" userName={listUser} status="PLANNING" />
      <ListRow title="Completed" userName={listUser} status="COMPLETED" />
      <ListRow title="Paused" userName={listUser} status="PAUSED" />
    {/if}
    {#if $malToken}
      <MalListRow title="Watching (MAL)" status="watching" />
      <MalListRow title="Plan to Watch (MAL)" status="plan_to_watch" />
      <MalListRow title="Completed (MAL)" status="completed" />
    {/if}
  {:else}
    <div class="grid min-h-[50vh] place-items-center text-center">
      <div class="max-w-sm">
        <p class="mb-4 text-sm text-muted-foreground">Connect AniList or MyAnimeList to see your library here.</p>
        <a href="/app/settings/accounts" data-focusable
           class="rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Connect an account</a>
      </div>
    </div>
  {/if}
</div>
