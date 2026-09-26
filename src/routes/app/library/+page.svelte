<script lang="ts">
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import WatchlistView from '$lib/components/schedule/WatchlistView.svelte'
</script>
<LibraryNav />
<main class="px-4 pb-24 pt-7 sm:px-8" data-slot="library">
  <header class="mb-7"><h1 class="text-3xl font-bold tracking-tight">Library</h1><p class="mt-2 text-sm text-muted-foreground">Saved for later, already watched, and everything in between.</p></header>
  <WatchlistView />
</main>
