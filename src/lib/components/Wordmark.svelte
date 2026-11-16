<script module lang="ts">
  const MARK = {
    display: 'inline-block',
    html: '<span role="img" aria-label="izumi"></span>',
    css: `span {
      display: inline-block;
      width: var(--izumi-safe-wordmark-width, calc(6.8 * var(--izumi-safe-rem)));
      aspect-ratio: 6.8 / 2;
      background: hsl(var(--izumi-safe-foreground));
      -webkit-mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
      mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
    }`,
  }
  const WHITE = {
    display: 'inline-flex',
    html: '<img src="/brand/izumi-wordmark-white.svg" alt="izumi" draggable="false">',
    css: 'img { display: block; height: calc(1.25 * var(--izumi-safe-rem)); filter: var(--izumi-safe-wordmark-filter, none); }',
  }
</script>

<script lang="ts">
  // The izumi wordmark. Themes never restyle it: it draws in a shadow root (themes/brand.ts) in the app's own
  // palette, sized from the brand's rem (app.css) so a theme's root size never changes it. A caller resizes it
  // with --izumi-safe-wordmark-width, which theme stylesheets cannot set. `white` is the white artwork for
  // headers, black on light palettes (app.css).
  import { brandShadow } from '$lib/themes/brand'

  let { className = '', white = false }: { className?: string; white?: boolean } = $props()
</script>

<span data-theme-protected class={className} use:brandShadow={white ? WHITE : MARK}></span>
