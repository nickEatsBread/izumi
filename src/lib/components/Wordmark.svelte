<script lang="ts">
  // The izumi wordmark. Themes never restyle it: `data-theme-protected` keeps theme stylesheets out
  // and gives it the app's own font and palette, and the brand's rem (app.css) keeps its size when a
  // theme changes the root font size.
  let { className = '' }: { className?: string } = $props()
</script>

<span data-theme-protected class="inline-block {className}"><span role="img" aria-label="izumi" class="izumi-wordmark"></span></span>

<style>
  .izumi-wordmark {
    display: inline-block;
    width: calc(6.8 * var(--izumi-safe-rem));
    height: calc(2 * var(--izumi-safe-rem));
    background: currentColor;
    -webkit-mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
    mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
  }
</style>
