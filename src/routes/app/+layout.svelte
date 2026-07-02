<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import { initInput, initDpadNav } from '$lib/nav'
  let { children } = $props()
  $effect(() => {
    initInput()
    initDpadNav()
  })
</script>
<Background />
<Sidebar />
<main class="ml-14 min-h-screen">{@render children()}</main>
