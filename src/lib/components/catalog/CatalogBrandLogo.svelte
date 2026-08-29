<script lang="ts">
  import type { CatalogScreen } from '$lib/settings/catalog'

  let {
    className = 'h-7 w-7',
  }: {
    platform: CatalogScreen
    className?: string
  } = $props()
</script>

<img
  aria-hidden="true"
  src="/brand/izumi-mark-color.svg"
  alt=""
  draggable="false"
  class="shrink-0 {className}"
/>
