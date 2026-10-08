<script lang="ts">
  // A compact multi-select dropdown: a labelled button showing the selection count, opening a
  // checklist panel. Closes on outside-click, Escape or B: the open panel is a nav layer, so the
  // shared Escape capture and the pad close it alone. On mobile the panel is viewport-anchored
  // (fixed, full width minus margins) so a right-edge trigger's list can't overflow off-screen.
  import { tick } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'
  import { isOskTarget } from '$lib/nav/osk'
  import { isMobile } from '$lib/platform'
  import { navLayer } from '$lib/nav/overlay'
  import { focusRestoreAllowed } from '$lib/nav/focus-memory'
  import type { NavLayerCloseReason } from '$lib/nav/layers'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import { menuPlacement } from '$lib/components/menu-placement'

  let {
    label, options, selected = [], onchange, labelOf, filter,
  }: {
    label: string
    options: string[]
    selected?: string[]
    onchange: (v: string[]) => void
    // Optional display mapper, for option lists whose VALUE is not meant to be read — e.g. language
    // codes, where the stored value must stay 'fr' but the row should read "French". Without it the
    // default title-casing applies, so existing callers are unaffected.
    labelOf?: (value: string) => string
    /** A search page filter: the trigger is the `search.filter` hook with this name in `data-filter`,
     *  and `data-active` while something is selected. */
    filter?: string
  } = $props()

  let open = $state(false)
  let root = $state<HTMLElement>()
  let trigger = $state<HTMLButtonElement>()
  let panel = $state<HTMLDivElement>()
  // Placement: a trigger low on the screen used to anchor its panel below itself regardless, so the
  // list ran off the bottom with no way to reach it. menuPlacement flips it and caps the height to
  // the room on the chosen side (see that module for the uiScale zoom caveat).
  const GAP = 4
  let placement = $state<'down' | 'up'>('down')
  // Viewport offsets in LOCAL px for the fixed mobile panel: `panelTop` when it hangs down,
  // `panelBottom` when it flips up.
  let panelTop = $state(0)
  let panelBottom = $state(0)
  let maxHeight = $state(288)

  function measure() {
    if (!root) return
    const zoom = rootZoom()
    const rect = root.getBoundingClientRect()
    const fit = menuPlacement({
      top: rect.top,
      bottom: rect.bottom,
      viewport: window.innerHeight,
      zoom,
      desired: 288,
      minHeight: 140,
    })
    placement = fit.side
    maxHeight = fit.maxHeight
    panelTop = rect.bottom / zoom + GAP
    panelBottom = window.innerHeight / zoom - rect.top / zoom + GAP
  }
  // Title-case, keeping known acronyms uppercase (TV, OVA, ONA) instead of "Tv"/"Ova"/"Ona".
  const ACRONYMS = new Set(['TV', 'OVA', 'ONA'])
  const pretty = (s: string) => s.split('_').map((w) => ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

  async function toggleOpen() {
    open = !open
    if (!open) return
    measure()
    // A pad or remote lands on the first ticked option (else the first row), so the list opens
    // where the choice is. Pointer users keep focus on the trigger, as before.
    if (!focusRestoreAllowed()) return
    await tick()
    ;(panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('[data-focusable]'))?.focus({ preventScroll: true })
  }

  /** Escape, B or remote Back: close and put focus back on the trigger. A navigation or a
   *  preempting prompt just closes. */
  function closePanel(reason: NavLayerCloseReason) {
    open = false
    if (reason === 'back') trigger?.focus({ preventScroll: true })
  }
  function toggle(o: string) {
    onchange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])
  }

  $effect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      // A tap on the on-screen keyboard is typing, not a press outside.
      if (isOskTarget(e.target)) return
      if (root && !root.contains(e.target as Node)) open = false
    }
    document.addEventListener('mousedown', onDoc)
    // The trigger moves under an open panel when the page scrolls or the window resizes, and the
    // mobile panel is viewport-anchored, so a stale offset leaves it detached from its button.
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  })
</script>

{#snippet optionList()}
  {#each options as o (o)}
    {@const on = selected.includes(o)}
    <button
      data-focusable
      aria-pressed={on}
      onclick={() => toggle(o)}
      class="flex w-full items-center gap-2 rounded px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent sm:py-1.5"
    >
      <span class="grid size-4 shrink-0 place-items-center rounded border {on ? 'border-theme bg-theme text-white' : 'border-muted-foreground/40'}">
        {#if on}<Check size={11} strokeWidth={3} />{/if}
      </span>
      <span class="truncate">{labelOf ? labelOf(o) : pretty(o)}</span>
    </button>
  {/each}
{/snippet}

<div bind:this={root} class="relative shrink-0">
  <button
    bind:this={trigger}
    data-part={filter ? 'search.filter' : undefined}
    data-filter={filter}
    data-active={(filter && selected.length > 0) || undefined}
    data-focusable
    onclick={toggleOpen}
    class="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-accent"
  >
    <span class={selected.length ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
      {label}{selected.length ? ` · ${selected.length}` : ''}
    </span>
    <ChevronDown size={14} class="text-muted-foreground transition-transform {open ? 'rotate-180' : ''}" />
  </button>
  {#if open}
    {#if $isMobile}
      <div
        bind:this={panel}
        data-nav-trap
        data-nav-escape
        data-nav-scroll-container
        use:navLayer={{ kind: 'multi-select', onClose: closePanel, initialFocus: 'none', returnFocus: 'none' }}
        class="fixed left-3 right-3 z-50 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1 shadow-2xl"
        style="{placement === 'down' ? `top:${panelTop}px` : `bottom:${panelBottom}px`};max-height:{maxHeight}px"
      >
        {@render optionList()}
      </div>
    {:else}
      <div
        bind:this={panel}
        data-nav-trap
        data-nav-escape
        data-nav-scroll-container
        use:navLayer={{ kind: 'multi-select', onClose: closePanel, initialFocus: 'none', returnFocus: 'none' }}
        class="absolute left-0 z-50 w-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1 shadow-2xl
          {placement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'}"
        style="max-height:{maxHeight}px"
      >
        {@render optionList()}
      </div>
    {/if}
  {/if}
</div>
