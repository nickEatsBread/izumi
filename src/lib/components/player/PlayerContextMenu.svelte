<script lang="ts" module>
  import type { Component } from 'svelte'
  export type PlayerMenuChoice = { label: string; checked: boolean; run: () => void }
  export type PlayerMenuItem = {
    label: string
    icon: Component<{ size?: number; class?: string }>
    /** The action's hotkey, as displayed. */
    hint?: string
    /** Current value, shown before a submenu's chevron. */
    value?: string
    /** Draw a divider above this item. */
    divider?: boolean
    run?: () => void
    submenu?: PlayerMenuChoice[]
  }
</script>

<script lang="ts">
  // The desktop player's right-click menu. Plain HTML over the video like the bar's other popovers
  // (the mpv picture shows through the transparent page; nothing here opens a native window).
  // Every item runs the same handler as its control-bar button. Closes on a pick, a click outside
  // and Escape (the overlay turns Escape into `player-menu-close` while a player menu is open).
  import { placeContextMenu } from './context-menu-pos'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Check from '@lucide/svelte/icons/check'

  let { at, root, items, onclose }: {
    /** The pointer, in client (screen) px. */
    at: { x: number; y: number }
    /** The player-sized element this menu is positioned in. */
    root: HTMLElement
    items: PlayerMenuItem[]
    onclose: () => void
  } = $props()

  let page = $state<PlayerMenuItem | null>(null)
  let w = $state(0)
  let h = $state(0)
  const pos = $derived.by(() => {
    const rect = root.getBoundingClientRect()
    // Local px per screen px: undoes the uiScale zoom (and any scale) on the way in.
    const scale = rect.width > 0 ? root.clientWidth / rect.width : 1
    return placeContextMenu((at.x - rect.left) * scale, (at.y - rect.top) * scale, w, h, root.clientWidth, root.clientHeight)
  })
  // A new right-click starts on the main list.
  $effect(() => { void at; page = null })

  function choose(run: () => void) {
    onclose()
    run()
  }
</script>

<button type="button" tabindex="-1" class="pointer-events-auto fixed inset-0 z-20 cursor-default" onclick={onclose} aria-label="Close menu"></button>
<div data-player-context-menu role="menu" bind:clientWidth={w} bind:clientHeight={h}
     class="pointer-events-auto absolute z-30 w-60 rounded-xl border border-white/10 bg-neutral-900 p-1.5 text-sm text-white shadow-2xl [transform:translateZ(0)] [will-change:transform]"
     style:left="{pos.left}px" style:top="{pos.top}px" style:visibility={w ? 'visible' : 'hidden'}>
  {#if page?.submenu}
    <button type="button" role="menuitem" class="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left font-semibold transition hover:bg-white/10" onclick={() => (page = null)}>
      <ChevronLeft size={16} />{page.label}
    </button>
    {#each page.submenu as choice (choice.label)}
      <button type="button" role="menuitemradio" aria-checked={choice.checked} class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left tabular-nums transition hover:bg-white/10" onclick={() => choose(choice.run)}>
        <span>{choice.label}</span>{#if choice.checked}<Check size={16} class="shrink-0" />{/if}
      </button>
    {/each}
  {:else}
    {#each items as item (item.label)}
      {#if item.divider}<div class="mx-2 my-1 h-px bg-white/10" role="separator"></div>{/if}
      <button type="button" role="menuitem" aria-haspopup={item.submenu ? 'menu' : undefined}
              class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/10"
              onclick={() => (item.submenu ? (page = item) : item.run && choose(item.run))}>
        <item.icon size={16} class="shrink-0 text-white/80" />
        <span class="min-w-0 flex-1 truncate">{item.label}</span>
        {#if item.value}<span class="shrink-0 text-xs tabular-nums text-white/50">{item.value}</span>{/if}
        {#if item.submenu}<ChevronRight size={14} class="shrink-0 text-white/50" />
        {:else if item.hint}<kbd class="shrink-0 font-mono text-[0.7rem] text-white/45">{item.hint}</kbd>{/if}
      </button>
    {/each}
  {/if}
</div>
