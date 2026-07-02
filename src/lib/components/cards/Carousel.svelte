<script lang="ts">
  import type { Snippet } from 'svelte'
  import { dragScroll } from '$lib/nav/actions'
  let { title, children }: { title: string; children: Snippet } = $props()
</script>
<section class="mb-8">
  <h2 class="mb-2 px-8 text-lg font-black">{title}</h2>
  <div use:dragScroll class="flex gap-3 overflow-x-scroll px-8 pb-2">{@render children()}</div>
</section>
