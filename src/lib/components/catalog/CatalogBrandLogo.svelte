<script lang="ts">
  import { isCustomScreen, type CatalogScreen, type CustomScreenId } from '$lib/settings/catalog'
  import { isSourceSelection, type SourceSelection } from '$lib/catalog/source-catalogs'
  import { brandShadow } from '$lib/themes/brand'

  let {
    platform,
    className = '',
  }: {
    platform: CatalogScreen
    className?: string
  } = $props()

  // Keep the Izumi silhouette while borrowing the selected catalog's brand colours. The active
  // screen is persisted by the catalog store, so the shell can keep this identity across routes.
  const gradients: Record<Exclude<CatalogScreen, CustomScreenId | SourceSelection>, readonly [string, string, string]> = {
    merged: ['#67E8F9', '#3B82F6', '#8B5CF6'],
    auto: ['#5CEAD8', '#1FA6F0', '#4E63F5'],
    anilist: ['#5CEAD8', '#1FA6F0', '#4E63F5'],
    kitsu: ['#FFB07A', '#FF6D59', '#A94F72'],
    tmdb: ['#90CEA1', '#3CBEC9', '#00B3E5'],
    stremio: ['#B79CFF', '#8D7DFF', '#6657E8'],
    jvm: ['#F7D7AA', '#D8894C', '#8D4B32'],
  }

  // Every custom screen shares one gradient, matching its tile in the catalog picker.
  // A source's own screen has one shared gradient too: izumi does not borrow a source's brand.
  const colors = $derived(isCustomScreen(platform) ? (['#E879F9', '#F43F5E', '#FB923C'] as const)
    : isSourceSelection(platform) ? (['#A3E635', '#22C55E', '#0D9488'] as const) : gradients[platform])

  // Drawn in a shadow root (themes/brand.ts) and sized from the brand's rem (app.css), so neither a theme's
  // stylesheet nor its root size changes the mark.
  const brand = $derived({
    display: 'inline-flex',
    html: '<span></span>',
    css: `span {
      display: inline-block;
      width: calc(1.75 * var(--izumi-safe-rem));
      height: calc(1.75 * var(--izumi-safe-rem));
      background: linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 55%, ${colors[2]} 100%);
      -webkit-mask: url('/brand/izumi-mark-color.svg') center / contain no-repeat;
      mask: url('/brand/izumi-mark-color.svg') center / contain no-repeat;
    }`,
  })
</script>

<span data-theme-protected aria-hidden="true" class="catalog-provider-mark {className}" use:brandShadow={brand}></span>
