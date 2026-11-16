<script lang="ts">
  // The plain "izumi" text beside the mark. Drawn in a shadow root like the wordmark (themes/brand.ts), so a
  // theme's fonts and stylesheet never change it; its size comes from the brand's rem (app.css), not the root's.
  // The weight is a prop: a weight class on the host would be within a theme's reach.
  import { brandShadow } from '$lib/themes/brand'

  let { className = '', weight = 900 }: { className?: string; weight?: number } = $props()

  const brand = $derived({
    display: 'inline-flex',
    html: '<span>izumi</span>',
    css: `span {
      display: inline-block;
      font-family: var(--izumi-safe-font);
      font-size: calc(1.125 * var(--izumi-safe-rem));
      line-height: calc(1.75 * var(--izumi-safe-rem));
      font-weight: ${weight};
      color: hsl(var(--izumi-safe-foreground));
    }`,
  })
</script>

<span data-theme-protected class="izumi-brand-text {className}" use:brandShadow={brand}></span>
