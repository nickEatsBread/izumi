<script lang="ts">
  import { navConfig, effectiveNav, resetNav, NAV_META, HOME_META, type NavPlacement } from '$lib/settings/nav'
  import * as h from '$lib/haptics'
  import ChevronUp from 'lucide-svelte/icons/chevron-up'
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw'

  const HomeIcon = HOME_META.icon
  const placements: { value: NavPlacement; label: string }[] = [
    { value: 'bottom', label: 'Bottom' },
    { value: 'top', label: 'Top' },
    { value: 'hidden', label: 'Hidden' },
  ]

  function setPlacement(id: string, p: NavPlacement) {
    h.tap()
    navConfig.set($effectiveNav.map((it) => (it.id === id ? { ...it, placement: p } : it)))
  }
  function move(i: number, dir: -1 | 1) {
    navConfig.set((() => {
      const c = $effectiveNav
      const j = i + dir
      if (j < 0 || j >= c.length) return c
      const next = [...c]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })())
    h.tap()
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Navigation</h2>
  <p class="mb-4 text-sm text-muted-foreground">Place each destination on the bottom bar, as a top-right icon on Home, or hide it — and reorder them. Home is always the first bottom tab.</p>

  <div class="max-w-2xl space-y-2">
    <div class="flex items-center gap-3 rounded-md border border-dashed border-border/60 p-3 text-muted-foreground">
      <HomeIcon size={18} />
      <span class="flex-1 font-bold">Home</span>
      <span class="text-xs">Always bottom</span>
    </div>

    {#each $effectiveNav as it, i (it.id)}
      {@const meta = NAV_META[it.id]}
      {@const Icon = meta.icon}
      <div class="flex items-center gap-2 rounded-md border border-border p-2.5">
        <Icon size={18} class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-sm font-bold">{meta.label}</span>

        <div class="flex shrink-0 rounded-lg bg-secondary p-0.5 text-xs font-bold">
          {#each placements as p (p.value)}
            <button data-focusable onclick={() => setPlacement(it.id, p.value)}
                    class="rounded-md px-2 py-1 transition-colors {it.placement === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">{p.label}</button>
          {/each}
        </div>

        <div class="flex shrink-0 flex-col">
          <button data-focusable aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}
                  class="grid size-6 place-items-center rounded transition-colors hover:bg-accent disabled:opacity-30"><ChevronUp size={15} /></button>
          <button data-focusable aria-label="Move down" disabled={i === $effectiveNav.length - 1} onclick={() => move(i, 1)}
                  class="grid size-6 place-items-center rounded transition-colors hover:bg-accent disabled:opacity-30"><ChevronDown size={15} /></button>
        </div>
      </div>
    {/each}

    <button data-focusable onclick={() => { h.tap(); resetNav() }}
            class="mt-2 flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
      <RotateCcw size={15} /> Reset to defaults
    </button>
  </div>
</div>
