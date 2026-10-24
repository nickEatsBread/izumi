<script lang="ts">
  import { navConfig, effectiveNav, resetNav, NAV_META, HOME_META, type NavItemId, type NavPlacement } from '$lib/settings/nav'
  import { allowedPlacements } from '$lib/settings/nav-rules'
  import { activeThemeKey, activeThemeLayout, setThemeLayoutEnabled } from '$lib/themes/layout-state'
  import ThemeLayoutNotice from '$lib/components/home/ThemeLayoutNotice.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import SelectMenu from './SelectMenu.svelte'
  import * as h from '$lib/haptics'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'

  const HomeIcon = HOME_META.icon
  const placements: { value: NavPlacement; label: string }[] = [
    { value: 'bottom', label: 'Bottom bar' },
    { value: 'top', label: 'Home header' },
    { value: 'hidden', label: 'Hidden' },
  ]
  // While a theme layout sets the navigation, its destinations and order are locked; "Customize a
  // copy" (the notice above) is the only way to get editable controls back.
  const themeNavLocked = $derived(!!$activeThemeLayout?.nav)

  function setPlacement(id: NavItemId, p: NavPlacement) {
    // Settings can't be hidden (nav-rules.ts); the menu never offers it, this guards any caller.
    if (!allowedPlacements(id).includes(p)) return
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

{#snippet homeIcon()}<HomeIcon size={18} class="text-muted-foreground" />{/snippet}
{#snippet resetControl()}
  <button type="button" data-focusable disabled={themeNavLocked} onclick={() => { h.tap(); resetNav() }}
          class="inline-flex min-h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm font-bold transition-colors hover:bg-accent disabled:opacity-50">
    <RotateCcw size={15} /> Reset
  </button>
{/snippet}

<div class="space-y-3" data-setting-key="navigation-items">
  <ThemeLayoutNotice what="navigation" oncopy={copyThemeNav} />
  <div class="relative divide-y divide-border/70 rounded-xl border border-border bg-card/25 [&>*:first-child]:rounded-t-[calc(0.75rem-1px)] [&>*:last-child]:rounded-b-[calc(0.75rem-1px)]">
    <SettingsRow
      title="Home"
      description="Always the first bottom tab"
      learnMore="Place each destination on the bottom bar, as a top-right icon on Home, or hide it, and reorder them. Settings can't be hidden, so you can always get back here."
      leading={homeIcon}
    />
    {#each $effectiveNav as it, i (it.id)}
      {@const meta = NAV_META[it.id]}
      {@const Icon = meta.icon}
      {#snippet destinationIcon()}<Icon size={18} class="text-muted-foreground" />{/snippet}
      {#snippet placementControl()}
        {#if themeNavLocked}
          <span class="text-sm text-muted-foreground">{placements.find((p) => p.value === it.placement)?.label}</span>
        {:else}
          <SelectMenu variant="inline" value={it.placement} onChange={(value) => setPlacement(it.id, value as NavPlacement)} ariaLabel={`${meta.label} placement`}
            options={placements.filter((p) => allowedPlacements(it.id).includes(p.value))} />
        {/if}
        <button type="button" data-focusable aria-label={`Move ${meta.label} up`} disabled={themeNavLocked || i === 0} data-touch-target onclick={() => move(i, -1)}
                class="grid size-9 place-items-center rounded transition-colors active:bg-accent disabled:opacity-30 sm:hover:bg-accent"><ChevronUp size={15} /></button>
        <button type="button" data-focusable aria-label={`Move ${meta.label} down`} disabled={themeNavLocked || i === $effectiveNav.length - 1} data-touch-target onclick={() => move(i, 1)}
                class="grid size-9 place-items-center rounded transition-colors active:bg-accent disabled:opacity-30 sm:hover:bg-accent"><ChevronDown size={15} /></button>
      {/snippet}
      <!-- Stacked on a phone: the placement menu and two 44px move buttons leave no room for the name inline. -->
      <SettingsRow title={meta.label} leading={destinationIcon} control={placementControl} controlLayout="stack" />
    {/each}
    <SettingsRow title="Reset to defaults" description="Bottom bar and Home header" control={resetControl} />
  </div>
</div>
