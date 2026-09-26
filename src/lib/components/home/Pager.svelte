<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import type { BlockPagination } from '$lib/home/blocks'
  import { pageWindow } from '$lib/home/pager'

  // Page controls under a block: numbered pages (a streaming-site pager) or one "Load more" button.
  let { page, hasNext, lastPage, mode, loading = false, onpage }: {
    page: number
    hasNext: boolean
    lastPage?: number
    mode: BlockPagination
    loading?: boolean
    onpage: (page: number) => void
  } = $props()

  const items = $derived(pageWindow(page, hasNext, lastPage))
</script>

{#if mode === 'numbers' && (page > 1 || hasNext)}
  <nav data-part="pagination" aria-label="Pages" class="mt-5 flex flex-wrap items-center justify-center gap-1.5">
    <button type="button" data-focusable disabled={page <= 1 || loading} onclick={() => onpage(page - 1)} aria-label="Previous page"
      class="grid size-9 place-items-center rounded-md bg-secondary transition hover:bg-accent disabled:opacity-40"><ChevronLeft size={16} /></button>
    {#each items as item, index (index)}
      {#if item === 'gap'}
        <span class="px-1 text-sm text-muted-foreground" aria-hidden="true">…</span>
      {:else}
        <button type="button" data-part="page-number" data-active={item === page || undefined} data-focusable disabled={loading}
          aria-current={item === page ? 'page' : undefined} onclick={() => { if (item !== page) onpage(item) }}
          class="h-9 min-w-[2.25rem] rounded-md px-2.5 text-sm font-bold tabular-nums transition {item === page ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'}">{item}</button>
      {/if}
    {/each}
    <button type="button" data-focusable disabled={!hasNext || loading} onclick={() => onpage(page + 1)} aria-label="Next page"
      class="grid size-9 place-items-center rounded-md bg-secondary transition hover:bg-accent disabled:opacity-40"><ChevronRight size={16} /></button>
  </nav>
{:else if mode === 'more' && hasNext}
  <div data-part="pagination" class="mt-5 flex justify-center">
    <button type="button" data-part="button" data-variant="secondary" data-focusable disabled={loading} onclick={() => onpage(page + 1)}
      class="min-h-10 rounded-md bg-secondary px-5 text-sm font-bold transition hover:bg-accent disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button>
  </div>
{/if}
