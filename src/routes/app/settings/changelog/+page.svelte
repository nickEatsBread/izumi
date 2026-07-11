<script lang="ts">
  import { fetchChangelog } from '$lib/changelog'
  const entries = fetchChangelog()
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
</script>

<div class="mx-auto max-w-2xl p-8">
  <h1 class="text-xl font-bold">Changelog</h1>
  <p class="mt-1 text-sm text-muted-foreground">Recent changes, straight from the commit history.</p>

  <div class="mt-6 space-y-2">
    {#await entries}
      {#each Array(6) as _}
        <div class="flex gap-3 rounded-lg border border-border p-3">
          <div class="skeloader h-4 w-20 shrink-0 rounded"></div>
          <div class="skeloader h-4 flex-1 rounded"></div>
        </div>
      {/each}
    {:then list}
      {#each list as e (e.sha)}
        <div class="flex items-baseline gap-3 rounded-lg border border-border p-3">
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(e.date)}</span>
          <span class="min-w-0 flex-1 text-sm">{e.message}</span>
          <span class="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{e.sha.slice(0, 7)}</span>
        </div>
      {/each}
      {#if !list.length}<p class="text-sm text-muted-foreground">No changes to show.</p>{/if}
    {:catch}
      <p class="rounded-lg border border-border p-3 text-sm text-muted-foreground">Couldn't load the changelog. Check your connection and try again.</p>
    {/await}
  </div>
</div>
