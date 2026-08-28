<script lang="ts">
  import type { CatalogSelection } from '$lib/settings/catalog'

  let {
    platform,
    className = 'h-7 w-7',
  }: {
    platform: CatalogSelection
    className?: string
  } = $props()

  // The integrated picker always remains recognisably Izumi. Only its established three-stop
  // gradient changes, borrowing each catalog provider's core brand colours.
  const gradients: Record<CatalogSelection, readonly [string, string, string]> = {
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
