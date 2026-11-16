<script lang="ts">
  import { gameMode } from '$lib/player/session'

  // The categories, "All" first: a column down the side (`column`), or a row of chips on a phone.
  // In the column the lit category is the side region's default, so Left from the grid lands on it,
  // and Up from "All" goes to the lit sort pill (the region never lets Up/Down out on its own).
  let { genres, active, column, onSelect }: { genres: string[]; active: string; column: boolean; onSelect: (genre: string) => void } = $props()
  const items = $derived([{ value: '', label: 'All' }, ...[...new Set(genres.filter(Boolean))].map((genre) => ({ value: genre, label: genre }))])
</script>

<div data-part="browse.categories" role="group" aria-label="Categories"
     class={column ? 'flex flex-col gap-0.5' : '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]'}>
  {#each items as item, index (item.value)}
    {@const on = item.value === active}
    <button type="button" aria-pressed={on} data-focusable data-part="browse.category"
            data-state={on ? 'active' : undefined}
            data-nav-region-default={column && on ? '' : undefined}
            data-nav-up={column && index === 0 ? 'browse-sort' : undefined}
            onclick={() => { if (!on) onSelect(item.value) }}
            class="shrink-0 text-left text-sm font-semibold {$gameMode ? '' : 'transition-colors'}
                   {column ? 'min-h-10 rounded-lg px-3 py-2' : 'min-h-10 whitespace-nowrap rounded-full px-4'}
                   {on ? 'bg-foreground/10 font-bold text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'}">
      {item.label}
    </button>
  {/each}
</div>
