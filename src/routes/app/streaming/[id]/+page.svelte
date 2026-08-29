<script lang="ts">
  import { page } from '$app/state'
  import StreamingProviderHub from '$lib/components/catalog/StreamingProviderHub.svelte'

  const id = $derived(Number(page.params.id))
  const name = $derived(page.url.searchParams.get('name')?.trim() || 'Streaming service')
  const logo = $derived(page.url.searchParams.get('logo')?.trim() || undefined)
</script>

{#key `${id}:${name}`}<StreamingProviderHub {id} {name} {logo} />{/key}
