<script lang="ts">
  import { navConfig, effectiveNav, resetNav, NAV_META, HOME_META, type NavPlacement } from '$lib/settings/nav'
  import { activeThemeKey, activeThemeLayout, setThemeLayoutEnabled } from '$lib/themes/layout-state'
  import ThemeLayoutNotice from '$lib/components/home/ThemeLayoutNotice.svelte'
  import * as h from '$lib/haptics'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'

  const HomeIcon = HOME_META.icon
  const placements: { value: NavPlacement; label: string }[] = [
    { value: 'bottom', label: 'Bottom' },
    { value: 'top', label: 'Top' },
    { value: 'hidden', label: 'Hidden' },
  ]
  // While a theme layout sets the navigation, its destinations and order are locked; "Customize a
  // copy" (below) is the only way to get editable controls back.
  const themeNavLocked = $derived(!!$activeThemeLayout?.nav)

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
  function copyThemeNav() {
    const key = $activeThemeKey
    if (!key) return
    navConfig.set($effectiveNav.map((item) => ({ ...item })))
    setThemeLayoutEnabled(key, false)
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Navigation</h2>
  <p class="mb-4 text-sm text-muted-foreground">Place each destination on the bottom bar, as a top-right icon on Home, or hide it — and reorder them. Home is always the first bottom tab.</p>

  <div class="mb-4 max-w-2xl">
    <ThemeLayoutNotice what="navigation" oncopy={copyThemeNav} />
  </div>

  <div class="max-w-2xl space-y-2">
    <div class="flex items-center gap-3 rounded-md border border-dashed border-border/60 p-3 text-muted-foreground">
      <HomeIcon size={18} />
      <span class="flex-1 font-bold">Home</span>
      <span class="text-xs">Always bottom</span>
    </div>

    {#each $effectiveNav as it, i (it.id)}
      {@const meta = NAV_META[it.id]}
      {@const Icon = meta.icon}
      <!-- Stacked on a phone: destination name on one line, placement + reorder controls below. -->
      <div class="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:gap-2 sm:p-2.5">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <Icon size={18} class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate text-sm font-bold">{meta.label}</span>
        </div>

        <div class="flex items-center justify-end gap-2">
        <div class="flex shrink-0 rounded-lg bg-secondary p-1 text-sm font-bold sm:p-0.5 sm:text-xs">
          {#each placements as p (p.value)}
            <button data-focusable disabled={themeNavLocked} onclick={() => setPlacement(it.id, p.value)}
                    class="rounded-md px-3 py-2 transition-colors sm:px-2 sm:py-1 disabled:opacity-50 {it.placement === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">{p.label}</button>
          {/each}
        </div>

        <div class="flex shrink-0 gap-1 sm:flex-col sm:gap-0">
          <button data-focusable aria-label="Move up" disabled={themeNavLocked || i === 0} onclick={() => move(i, -1)}
                  class="grid size-10 place-items-center rounded transition-colors active:bg-accent disabled:opacity-30 sm:size-6 sm:hover:bg-accent"><ChevronUp size={15} /></button>
          <button data-focusable aria-label="Move down" disabled={themeNavLocked || i === $effectiveNav.length - 1} onclick={() => move(i, 1)}
                  class="grid size-10 place-items-center rounded transition-colors active:bg-accent disabled:opacity-30 sm:size-6 sm:hover:bg-accent"><ChevronDown size={15} /></button>
        </div>
        </div>
      </div>
    {/each}

    <button data-focusable disabled={themeNavLocked} onclick={() => { h.tap(); resetNav() }}
            class="mt-2 flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent disabled:opacity-50">
      <RotateCcw size={15} /> Reset to defaults
    </button>
  </div>
</div>
