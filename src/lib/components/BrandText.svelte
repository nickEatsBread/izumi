<script lang="ts">
  // The plain "izumi" text beside the mark. Protected like the wordmark, so a theme's fonts and
  // stylesheet never change it; its size comes from the brand's rem (app.css), not the root's.
  let { className = '' }: { className?: string } = $props()
</script>

<span data-theme-protected class="izumi-brand-text {className}">izumi</span>

<style>
  .izumi-brand-text {
    font-size: calc(1.125 * var(--izumi-safe-rem));
    line-height: calc(1.75 * var(--izumi-safe-rem));
  }
</style>
