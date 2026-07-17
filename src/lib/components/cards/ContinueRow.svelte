<script lang="ts">
  // The unified "Continue Watching" row. LOCAL-FIRST: it paints instantly from an on-device copy
  // (the persisted `cwSnapshot` view cache ∪ local watch history), then AniList (CURRENT) + MyAnimeList
  // (watching) reconcile in the BACKGROUND — no skeleton wait on the network. De-duped by media id,
  // resume-aware, most-recent first. All merge/sync logic lives in $lib/player/continue-watching.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { continueWatching, reconciling, reconciledOnce, reconcileContinueWatching } from '$lib/player/continue-watching'
  import Carousel from './Carousel.svelte'
  import ContinueCard from './ContinueCard.svelte'

  let { title, userName, malActive }: { title: string; userName?: string; malActive: boolean } = $props()
  const client = getContextClient()

  const items = $derived($continueWatching)
  // Cold first launch only: nothing cached AND a tracker could still fill the row.
  const cold = $derived(!items.length && $reconciling && (!!userName || malActive))
  // Provisional cue: gray the cached cards while the FIRST reconcile of the session runs, then swap
  // to crisp. Later home visits reconcile silently (data is already live).
  const provisional = $derived($reconciling && !$reconciledOnce && items.length > 0)

  onMount(() => { void reconcileContinueWatching(client, userName, malActive) })
</script>

{#if cold}
  <Carousel {title}>
    {#each Array.from({ length: 5 }) as _}
      <div class="aspect-video w-[264px] shrink-0 animate-pulse rounded-lg bg-muted"></div>
    {/each}
  </Carousel>
{:else if items.length}
  <Carousel {title}>
    {#each items as item (item.media.id)}
      <div class="shrink-0 transition-[opacity,filter] duration-300 {provisional ? 'opacity-40 grayscale' : ''}">
        <ContinueCard media={item.media} progress={item.progress} />
      </div>
    {/each}
  </Carousel>
{/if}
