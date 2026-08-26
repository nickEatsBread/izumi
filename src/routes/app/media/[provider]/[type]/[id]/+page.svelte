<script lang="ts">
  import { page } from '$app/state'
  import CatalogMediaDetail from '$lib/components/catalog/CatalogMediaDetail.svelte'
  import type { CatalogContentType, CatalogProviderId } from '$lib/catalog/identity'

  const provider = $derived(page.params.provider as CatalogProviderId)
  const type = $derived(page.params.type as CatalogContentType)
  const id = $derived(page.params.id ?? '')
</script>

{#key `${provider}:${type}:${id}`}<CatalogMediaDetail {provider} {type} {id} />{/key}
