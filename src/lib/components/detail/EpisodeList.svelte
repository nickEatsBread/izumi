<script lang="ts">
  // Simple 1..N episode grid. Clicking is a stub until Plan 3 (streaming) wires
  // real stream resolution. Rich per-episode metadata/thumbnails are Plan 2c.
  let { count, mediaId }: { count: number; mediaId: number } = $props()
  const episodes = $derived(count > 0 ? Array.from({ length: count }, (_, i) => i + 1) : [])
  function play(ep: number) {
    // STUB: real streaming wired in Plan 3.
    console.log('play', mediaId, ep)
  }
</script>
{#if episodes.length}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
    {#each episodes as ep (ep)}
      <button
        data-focusable
        onclick={() => play(ep)}
        class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2 text-left transition-colors hover:bg-accent"
      >
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded bg-background/40 text-sm font-black">{ep}</span>
        <span class="text-sm font-bold">Episode {ep}</span>
      </button>
    {/each}
  </div>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}
