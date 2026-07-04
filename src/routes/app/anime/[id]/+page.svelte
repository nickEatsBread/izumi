<script lang="ts">
  import { page } from '$app/state'
  import AnimeDetail from '$lib/components/detail/AnimeDetail.svelte'

  // Key AnimeDetail on the id so an anime→relation (same-route) navigation REMOUNTS it
  // with the new id and re-fetches. A same-route param change alone reuses the +page
  // component, so a mount-time `const id` would go stale (relations "did nothing").
  const id = $derived(Number(page.params.id))
</script>

{#key id}
  <AnimeDetail {id} />
{/key}
