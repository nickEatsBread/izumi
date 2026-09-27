<script lang="ts">
  // The plain "izumi" text beside the mark. Protected like the wordmark, so a theme's fonts and
  // stylesheet never change it.
  let { className = '' }: { className?: string } = $props()
</script>

<span data-theme-protected class="izumi-brand-text {className}">izumi</span>
