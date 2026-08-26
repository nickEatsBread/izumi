<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchChangelogPage, type ChangelogEntry } from '$lib/changelog'

  let entries = $state<ChangelogEntry[]>([])
  let page = 1
  let loading = $state(true)
  let hasMore = $state(true)
  let error = $state('')
  let sentinel = $state<HTMLElement>()

  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  async function loadMore(initial = false) {
    if ((!initial && loading) || !hasMore) return
    loading = true
    error = ''
    try {
      const next = await fetchChangelogPage(page)
      const seen = new Set(entries.map((entry) => entry.sha))
      entries = [...entries, ...next.entries.filter((entry) => !seen.has(entry.sha))]
      hasMore = next.hasMore
      page += 1
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void loadMore(true)
    if (!sentinel || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void loadMore()
    }, { rootMargin: '700px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  })
</script>

<div class="mx-auto max-w-2xl p-4 sm:p-8">
  <h1 class="text-xl font-bold">Changelog</h1>
  <p class="mt-1 text-sm text-muted-foreground">Recent changes, straight from the commit history.</p>

  <div class="mt-6 space-y-2">
    {#each entries as e (e.sha)}
      <!-- Stacked on a phone: date + message + sha on one baseline squeezed the message to a
           sliver at 360px; the sha drops under the message instead. -->
      <div class="flex flex-col gap-1 rounded-lg border border-border p-3 sm:flex-row sm:items-baseline sm:gap-3">
        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(e.date)}</span>
        <span class="min-w-0 flex-1 text-sm">{e.message}</span>
        <span class="shrink-0 font-mono text-xs text-muted-foreground sm:text-[0.65rem]">{e.sha.slice(0, 7)}</span>
      </div>
    {/each}

    {#if loading}
      {#each Array(6) as _}
        <div class="flex gap-3 rounded-lg border border-border p-3">
          <div class="skeloader h-4 w-20 shrink-0 rounded"></div>
          <div class="skeloader h-4 flex-1 rounded"></div>
        </div>
      {/each}
    {/if}

    {#if error}
      <div class="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        <p>Couldn't load more changes. Check your connection and try again.</p>
        <button data-focusable onclick={() => loadMore()} class="mt-2 rounded-md bg-secondary px-3 py-2 font-bold text-foreground hover:bg-accent sm:py-1.5">Try again</button>
      </div>
    {:else if !loading && !entries.length}
      <p class="text-sm text-muted-foreground">No changes to show.</p>
    {/if}

    <div bind:this={sentinel} aria-hidden="true" class="h-px"></div>
  </div>
</div>
