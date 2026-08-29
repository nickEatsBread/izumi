<script lang="ts">
  import type { CatalogScreen } from '$lib/settings/catalog'

  let {
    platform,
    className = 'h-7 w-7',
  }: {
    platform: CatalogScreen
    className?: string
  } = $props()

  // Keep the Izumi silhouette while borrowing the selected catalog's brand colours. The active
  // screen is persisted by the catalog store, so the shell can keep this identity across routes.
  const gradients: Record<CatalogScreen, readonly [string, string, string]> = {
    merged: ['#67E8F9', '#3B82F6', '#8B5CF6'],
    auto: ['#5CEAD8', '#1FA6F0', '#4E63F5'],
    anilist: ['#5CEAD8', '#1FA6F0', '#4E63F5'],
    kitsu: ['#FFB07A', '#FF6D59', '#A94F72'],
    tmdb: ['#90CEA1', '#3CBEC9', '#00B3E5'],
    stremio: ['#B79CFF', '#8D7DFF', '#6657E8'],
    jvm: ['#F7D7AA', '#D8894C', '#8D4B32'],
  }

  const colors = $derived(gradients[platform])
</script>

<span
  aria-hidden="true"
  class="catalog-provider-mark {className}"
  style={`--catalog-start:${colors[0]};--catalog-mid:${colors[1]};--catalog-end:${colors[2]}`}
></span>

<style>
  .catalog-provider-mark {
    display: inline-block;
    flex: none;
    background: linear-gradient(135deg, var(--catalog-start) 0%, var(--catalog-mid) 55%, var(--catalog-end) 100%);
    -webkit-mask: url('/brand/izumi-mark-color.svg') center / contain no-repeat;
    mask: url('/brand/izumi-mark-color.svg') center / contain no-repeat;
  }
</style>
