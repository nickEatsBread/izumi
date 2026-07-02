<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import { initInput, initDpadNav } from '$lib/nav'
  let { children } = $props()
  $effect(() => {
    initInput()
    initDpadNav()
  })
</script>

<!-- Solid app floor; the full-bleed banner is rendered inline per-page (Hero). -->
<Background />
<Sidebar />
<Titlebar />
<main class="relative ml-14 min-h-screen overflow-x-clip">{@render children()}</main>
