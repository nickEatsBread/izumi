<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import BannerBg from '$lib/components/shell/BannerBg.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import { initInput, initDpadNav } from '$lib/nav'
  let { children } = $props()
  $effect(() => {
    initInput()
    initDpadNav()
  })
</script>

<!-- Solid app background (furthest back), then the shared full-bleed banner. -->
<Background />
<BannerBg />
<Sidebar />
<Titlebar />
<main class="relative ml-14 min-h-screen">{@render children()}</main>
