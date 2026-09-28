<script lang="ts">
  // The izumi wordmark. Themes never restyle it: `data-theme-protected` keeps theme stylesheets out
  // and gives it the app's own font and palette.
  let { className = '' }: { className?: string } = $props()
</script>

<span data-theme-protected class="inline-block {className}"><span role="img" aria-label="izumi" class="izumi-wordmark"></span></span>

<style>
  .izumi-wordmark {
    display: inline-block;
    width: 6.8rem;
    height: 2rem;
    background: currentColor;
    -webkit-mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
    mask: url('/brand/izumi-wordmark-white.svg') center / contain no-repeat;
  }
</style>
