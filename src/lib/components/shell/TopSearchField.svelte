<script lang="ts">
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'

  // The theme top bar's inline search: Enter opens the search page with the query.
  let { className = '' }: { className?: string } = $props()
  let query = $state('')

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const text = query.trim()
    void goto(text ? `/app/search?search=${encodeURIComponent(text)}` : '/app/search')
  }
</script>

<form role="search" onsubmit={submit} class="relative {className}">
  <Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
  <input data-part="search.field" data-focusable type="search" bind:value={query} placeholder="Search anime…" aria-label="Search"
    class="h-9 w-full rounded-lg border border-border bg-secondary/60 pl-9 pr-3 text-sm outline-none transition focus:border-theme/70 focus:bg-background" />
</form>
