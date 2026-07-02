<script lang="ts">
  // Simple 1..N episode grid. Clicking resolves a debrid stream (Stremio addon)
  // and hands the URL to mpv. Rich per-episode metadata/thumbnails are Plan 2c.
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  let { count, mediaId }: { count: number; mediaId: number } = $props()
  const episodes = $derived(count > 0 ? Array.from({ length: count }, (_, i) => i + 1) : [])
  let state = $state<PlayState>({ status: 'idle' })
  const resolving = $derived(state.status === 'resolving')
  function play(ep: number) {
    if (resolving) return
    playEpisode(mediaId, ep, (s) => (state = s))
  }
</script>
{#if episodes.length}
  {#if state.status === 'resolving'}
    <p class="mb-3 text-sm text-muted-foreground">Resolving stream…</p>
  {:else if state.status === 'error'}
    <p class="mb-3 text-sm text-destructive">{state.message}</p>
  {/if}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
    {#each episodes as ep (ep)}
      <button
        data-focusable
        disabled={resolving}
        onclick={() => play(ep)}
        class="flex items-center gap-3 rounded-md bg-secondary px-3 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded bg-background/40 text-sm font-black">{ep}</span>
        <span class="text-sm font-bold">Episode {ep}</span>
      </button>
    {/each}
  </div>
{:else}
  <p class="text-sm text-muted-foreground">Episodes TBA</p>
{/if}
