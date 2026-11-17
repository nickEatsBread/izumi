<script lang="ts">
  // Trending rows for an empty Search page (`search.trending`), each shown as its catalog answers.
  // Home's own row, so a theme styles them as it styles Home's rows.
  import CatalogSectionRow from '$lib/components/catalog/CatalogSectionRow.svelte'
  import type { CatalogSelection } from '$lib/settings/catalog'
  import { trendingSections } from './trending'

  let { selections }: { selections: readonly CatalogSelection[] } = $props()
  const rows = $derived(trendingSections(selections))
</script>

{#if rows.length}
  <!-- Home rows carry their own edge padding: undo the page's so they line up with it. -->
  <div data-slot="search.trending" class="-mx-4 sm:-mx-8">
    {#each rows as row}
      {#await row then section}
        {#if section}<CatalogSectionRow {section} />{/if}
      {/await}
    {/each}
  </div>
{/if}
