<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  let { children } = $props()
</script>
<Background />
<Sidebar />
<main class="ml-14 min-h-screen">{@render children()}</main>
