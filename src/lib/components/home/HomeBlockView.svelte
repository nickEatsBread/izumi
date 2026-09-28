<script lang="ts">
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import { homeBlocks, type HomeBlock } from '$lib/home/blocks'
  import GenreChips from './blocks/GenreChips.svelte'
  import LatestEpisodes from './blocks/LatestEpisodes.svelte'
  import ProfileHeader from './blocks/ProfileHeader.svelte'
  import RankedList from './blocks/RankedList.svelte'
  import TabbedGrid from './blocks/TabbedGrid.svelte'

  // One Home block, by id. `optionIds` are the current Home's row ids; Merged Home resolves tab roles against them.
  // `block` overrides the stored lookup with an already-resolved block (a theme's ephemeral row).
  let { id, target, optionIds = [], block: override }: { id: string; target: CatalogHomeTarget; optionIds?: string[]; block?: HomeBlock } = $props()
  const block = $derived(override ?? $homeBlocks[id])
</script>

{#if block?.type === 'latest-episodes'}
  <LatestEpisodes {block} />
{:else if block?.type === 'tabbed-grid'}
  <TabbedGrid {block} {target} {optionIds} />
{:else if block?.type === 'genre-chips'}
  <GenreChips {block} {target} />
{:else if block?.type === 'ranked-list'}
  <RankedList {block} {target} {optionIds} />
{:else if block?.type === 'profile-header'}
  <ProfileHeader {block} />
{/if}
