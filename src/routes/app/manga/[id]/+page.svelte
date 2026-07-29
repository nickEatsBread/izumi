<script lang="ts">
  import { page } from '$app/state'
  import ReadingDetail from '$lib/components/detail/ReadingDetail.svelte'

  const id = $derived(Number(page.params.id))
</script>

{#key id}
  <ReadingDetail {id} />
{/key}
