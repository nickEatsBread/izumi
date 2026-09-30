<script lang="ts">
  // The themed episode toolbar (API 3 `detail.episodes`): a bar, or a heading row with compact
  // buttons, holding the controls the theme lists in `controls`, in its order. Every other control
  // that applies moves into the overflow menu (`episodes.more`), so a theme can rearrange the
  // toolbar but never take a feature away. EpisodeList owns the list state; this only draws it.
  //
  // The overflow menu (a popover; a sheet on phones) and the range list are portalled to <body>, so
  // a transformed ancestor or the right-hand rail's scroll box can neither offset nor clip them. A
  // popover is fixed at its button in local px (menu-anchor.ts, shared with the season list). An
  // open menu keeps the d-pad inside it, scrolls only its own list to the focused entry
  // (`data-nav-scroll-container`), and closes on Escape or B (NavDrawer.svelte).
  import { tick, type Snippet } from 'svelte'
  import type { SortDir } from '$lib/anime/episode-order'
  import type { EpisodeControl } from '$lib/themes/presentation'
  import type { EpisodeToolbarPlan } from './toolbar-plan'
  import { episodeLayout } from '$lib/settings/ui'
  import { isMobile } from '$lib/platform'
  import { portal } from '$lib/util/portal'
  import { isOskTarget } from '$lib/nav/osk'
  import { anchoredMenuStyle, centreInList } from '$lib/components/menu-anchor'
  import * as h from '$lib/haptics'
  import Search from '@lucide/svelte/icons/search'
  import ArrowDown01 from '@lucide/svelte/icons/arrow-down-0-1'
  import ArrowUp10 from '@lucide/svelte/icons/arrow-up-1-0'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import Rows3 from '@lucide/svelte/icons/rows-3'
  import Download from '@lucide/svelte/icons/download'
  import ListPlus from '@lucide/svelte/icons/list-plus'
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'
  import X from '@lucide/svelte/icons/x'

  let {
    plan, order, total, sortDir = $bindable(), query = $bindable(), ranges, page, onpage,
    onlayout, ondownload, onqueue, queueLabel, queueTitle, lead,
  }: {
    plan: EpisodeToolbarPlan
    /** How an inline sort control looks: two options, or one toggle. */
    order: 'tabs' | 'flip'
    total: number
    sortDir: SortDir
    query: string
    /** Range labels for `paging: "dropdown"`; empty otherwise. */
    ranges: string[]
    page: number
    onpage: (index: number) => void
    onlayout: (next: 'list' | 'grid') => void
    ondownload: () => void
    onqueue: () => void
    queueLabel: string
    queueTitle: string
    /** Drawn in place of the "Episodes" heading of a heading row (the season dropdown). */
    lead?: Snippet
  } = $props()

  const header = $derived(plan.variant === 'header')
  const grid = $derived($episodeLayout === 'grid')
  const showRanges = $derived(ranges.length > 1 && !query.trim())
  const visible = $derived(header || showRanges || plan.inline.length > 0 || plan.menu.length > 0)
  let searchOpen = $state(false)
  let menuOpen = $state(false)
  let rangeOpen = $state(false)
  let field = $state<HTMLInputElement>()
  let moreButton = $state<HTMLButtonElement>()
  let rangeButton = $state<HTMLButtonElement>()
  let menuPanel = $state<HTMLElement>()
  let rangePanel = $state<HTMLElement>()
  let menuPlace = $state('')
  let rangePlace = $state('')
  const iconClass = 'grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground transition-colors hover:bg-accent'
  const textClass = 'flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-bold transition-colors hover:bg-accent'
  const rowClass = 'flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-bold transition-colors hover:bg-accent'

  function sortTo(dir: SortDir) { if (dir !== sortDir) { h.select(); sortDir = dir } }
  function flip() { h.select(); sortDir = sortDir === 'asc' ? 'desc' : 'asc' }
  function toggleSearch() {
    h.tap()
    searchOpen = !searchOpen
    if (searchOpen) requestAnimationFrame(() => field?.focus())
    else query = ''
  }

  function place() {
    if (menuOpen && !$isMobile) menuPlace = anchoredMenuStyle(moreButton, menuPanel, 'end')
    if (rangeOpen) rangePlace = anchoredMenuStyle(rangeButton, rangePanel, 'start', 320)
  }
  /** Place a menu that just opened, again once it has its real size, then focus an entry so a
   *  controller or keyboard starts inside it. The focus moves nothing (the page behind stays put), so
   *  the menu's own list scrolls the entry into view once its height cap is in. */
  async function settle(panel: () => HTMLElement | undefined, entry: string) {
    place()
    await tick()
    place()
    await tick()
    const root = panel()
    const target = root?.querySelector<HTMLElement>(entry) ?? root?.querySelector<HTMLElement>('[data-focusable]')
    centreInList(root, target)
    target?.focus({ preventScroll: true })
  }
  function toggleMenu() {
    h.tap()
    rangeOpen = false
    menuOpen = !menuOpen
    if (menuOpen) void settle(() => menuPanel, '[data-focusable]')
  }
  function toggleRange() {
    h.tap()
    menuOpen = false
    rangeOpen = !rangeOpen
    if (rangeOpen) void settle(() => rangePanel, '[data-active]')
  }
  /** Close whichever menu is open; `refocus` (Escape, B) puts focus back on its button. */
  function closeMenus(refocus = false) {
    const button = menuOpen ? moreButton : rangeOpen ? rangeButton : undefined
    menuOpen = false
    rangeOpen = false
    if (refocus) button?.focus({ preventScroll: true })
  }
  // Menu entries close the menu first, so a sheet never stays over the list it just changed, and
  // hand focus back to the overflow button rather than to the page behind the menu.
  function choose(action: () => void) {
    menuOpen = false
    moreButton?.focus({ preventScroll: true })
    action()
  }
  function pickRange(index: number) {
    rangeOpen = false
    rangeButton?.focus({ preventScroll: true })
    h.select()
    onpage(index)
  }

  // While a popover is open it follows its button through scrolling and resizing, and a press
  // anywhere else closes it (CategoriesMenu.svelte). The phone sheet closes from its own scrim
  // instead, so that tap never lands on the episode underneath.
  $effect(() => {
    if (!menuOpen && !rangeOpen) return
    const follow = () => place()
    const outside = (event: PointerEvent) => {
      // A tap on the on-screen keyboard is typing, not a press outside.
      if (isOskTarget(event.target)) return
      const target = event.target as Node
      if (menuOpen && !$isMobile && !menuPanel?.contains(target) && !moreButton?.contains(target)) menuOpen = false
      if (rangeOpen && !rangePanel?.contains(target) && !rangeButton?.contains(target)) rangeOpen = false
    }
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('pointerdown', outside, true)
    }
  })
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && (menuOpen || rangeOpen)) { event.preventDefault(); closeMenus(true) } }} />

{#snippet sortControl()}
  {#if order === 'flip'}
    <button type="button" data-part="episodes.sort" data-variant="flip" data-dir={sortDir} data-focusable onclick={flip}
            title={sortDir === 'asc' ? 'Show newest first' : 'Show oldest first'}
            class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
      {#if sortDir === 'asc'}<ArrowDown01 size={17} />{:else}<ArrowUp10 size={17} />{/if}
      <span>{sortDir === 'asc' ? 'Oldest' : 'Newest'}</span>
    </button>
  {:else}
    <div data-part="episodes.sort" data-variant="tabs" data-dir={sortDir} class="flex h-9 shrink-0 rounded-lg bg-secondary p-0.5 text-sm font-bold">
      <button type="button" data-focusable data-active={sortDir === 'asc' || undefined} onclick={() => sortTo('asc')}
              class="rounded-md px-3 transition-colors {sortDir === 'asc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Oldest</button>
      <button type="button" data-focusable data-active={sortDir === 'desc' || undefined} onclick={() => sortTo('desc')}
              class="rounded-md px-3 transition-colors {sortDir === 'desc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}">Newest</button>
    </div>
  {/if}
{/snippet}

{#snippet searchField(inline: boolean)}
  <label data-part="episodes.search" class={inline ? 'relative min-w-[10rem] flex-1' : 'relative mb-4 block min-w-0'}>
    <Search size={15} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input data-part="input" bind:this={field} bind:value={query} data-focusable placeholder="Find episode number or title…"
           class="h-10 w-full rounded-lg bg-input pl-9 pr-10 text-base sm:text-sm" />
    {#if query}
      <button type="button" data-focusable aria-label="Clear search" onclick={() => (query = '')}
              class="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
        <X size={15} />
      </button>
    {/if}
  </label>
{/snippet}

{#snippet control(item: EpisodeControl)}
  {#if item === 'sort'}
    {@render sortControl()}
  {:else if item === 'layout'}
    <button type="button" data-part="episodes.layout" data-layout={$episodeLayout} data-focusable onclick={() => onlayout(grid ? 'list' : 'grid')}
            aria-label={grid ? 'Show episode cards' : 'Show episode numbers'} title={grid ? 'Show episode cards' : 'Show episode numbers'} class={iconClass}>
      {#if grid}<Rows3 size={17} />{:else}<LayoutGrid size={17} />{/if}
    </button>
  {:else if item === 'search'}
    {#if plan.search === 'inline'}
      {@render searchField(true)}
    {:else}
      <button type="button" data-part="episodes.search" data-active={searchOpen || undefined} data-focusable onclick={toggleSearch}
              aria-label="Search episodes" aria-pressed={searchOpen} class={iconClass}>
        <Search size={17} />
      </button>
    {/if}
  {:else if item === 'download'}
    <button type="button" data-part="episodes.download" data-focusable onclick={ondownload}
            aria-label="Download episodes" title="Download episodes" class={header ? iconClass : textClass}>
      <Download size={16} />{#if !header}<span>Download…</span>{/if}
    </button>
  {:else}
    <button type="button" data-part="episodes.queue" data-focusable onclick={onqueue}
            aria-label={queueTitle} title={queueTitle} class={header ? iconClass : textClass}>
      <ListPlus size={16} />{#if !header}<span>{queueLabel}</span>{/if}
    </button>
  {/if}
{/snippet}

{#snippet menuItems()}
  {#each plan.menu as item (item)}
    {#if item === 'sort'}
      <p class="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Sort</p>
      <button type="button" data-control="sort" data-active={sortDir === 'asc' || undefined} data-focusable onclick={() => choose(() => sortTo('asc'))} class={rowClass}>
        <span class="flex-1">Oldest first</span>{#if sortDir === 'asc'}<Check size={15} class="text-theme" />{/if}
      </button>
      <button type="button" data-control="sort" data-active={sortDir === 'desc' || undefined} data-focusable onclick={() => choose(() => sortTo('desc'))} class={rowClass}>
        <span class="flex-1">Newest first</span>{#if sortDir === 'desc'}<Check size={15} class="text-theme" />{/if}
      </button>
    {:else if item === 'layout'}
      <p class="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Layout</p>
      <button type="button" data-control="layout" data-active={!grid || undefined} data-focusable onclick={() => choose(() => onlayout('list'))} class={rowClass}>
        <Rows3 size={16} /><span class="flex-1">Cards</span>{#if !grid}<Check size={15} class="text-theme" />{/if}
      </button>
      <button type="button" data-control="layout" data-active={grid || undefined} data-focusable onclick={() => choose(() => onlayout('grid'))} class={rowClass}>
        <LayoutGrid size={16} /><span class="flex-1">Numbers</span>{#if grid}<Check size={15} class="text-theme" />{/if}
      </button>
    {:else if item === 'search'}
      <button type="button" data-control="search" data-active={searchOpen || undefined} data-focusable onclick={() => choose(toggleSearch)} class={rowClass}>
        <Search size={16} /><span class="flex-1">{searchOpen ? 'Close search' : 'Search episodes'}</span>
      </button>
    {:else if item === 'download'}
      <button type="button" data-control="download" data-focusable onclick={() => choose(ondownload)} class={rowClass}>
        <Download size={16} /><span class="flex-1">Download episodes…</span>
      </button>
    {:else}
      <button type="button" data-control="queue" data-focusable onclick={() => choose(onqueue)} class={rowClass}>
        <ListPlus size={16} /><span class="flex-1">{queueLabel}</span>
      </button>
    {/if}
  {/each}
{/snippet}

{#snippet rangePicker()}
  <div class="shrink-0">
    <button bind:this={rangeButton} type="button" data-part="episodes.range" data-open={rangeOpen || undefined} data-focusable
            aria-haspopup="true" aria-expanded={rangeOpen} onclick={toggleRange}
            class="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-bold">
      {ranges[page] ?? ranges[0]}<ChevronDown size={16} class="opacity-70" />
    </button>
    {#if rangeOpen}
      <div use:portal bind:this={rangePanel} data-part="episodes.menu" data-variant="range" data-nav-trap data-nav-escape style={rangePlace} data-nav-scroll-container
           class="fixed z-[60] w-48 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1.5 shadow-2xl">
        {#each ranges as range, index (index)}
          <button type="button" data-part="page-number" data-active={index === page || undefined} data-focusable
                  aria-current={index === page ? 'true' : undefined} onclick={() => pickRange(index)}
                  class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-bold hover:bg-accent">
            <span class="flex-1">{range}</span>{#if index === page}<Check size={15} class="text-theme" />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#if visible}
  <div data-slot="episodes.toolbar" data-variant={plan.variant} class="relative mb-4 flex flex-wrap items-center gap-2">
    {#if header}
      {#if lead}
        <div class="mr-auto min-w-0">{@render lead()}</div>
      {:else}
        <h2 data-part="episodes.heading" class="mr-auto flex items-baseline gap-2 text-lg font-black">
          Episodes<span data-part="episodes.count" class="text-sm font-bold text-muted-foreground">{total}</span>
        </h2>
      {/if}
    {/if}
    {#if showRanges}{@render rangePicker()}{/if}
    {#each plan.inline as item (item)}{@render control(item)}{/each}
    {#if plan.menu.length}
      <!-- A heading row already pushes its controls to the end; a bar pushes only the menu there. -->
      <div class="shrink-0 {header ? '' : 'ml-auto'}">
        <button bind:this={moreButton} type="button" data-part="episodes.more" data-focusable aria-haspopup="true" aria-expanded={menuOpen}
                aria-label="More episode options" title="More episode options" onclick={toggleMenu}
                class={iconClass}>
          <EllipsisVertical size={17} />
        </button>
        {#if menuOpen && !$isMobile}
          <div use:portal bind:this={menuPanel} data-part="episodes.menu" data-variant="more" data-nav-trap data-nav-escape style={menuPlace} data-nav-scroll-container
               class="fixed z-[60] w-60 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-2 shadow-2xl">
            {@render menuItems()}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
{#if menuOpen && $isMobile}
  <div use:portal role="dialog" aria-modal="true" aria-label="Episode options" tabindex="-1" data-nav-trap data-nav-escape
       class="fixed inset-0 z-[70] grid h-[100dvh] place-items-end bg-black/70"
       onclick={(event) => { if (event.target === event.currentTarget) closeMenus() }}
       onkeydown={(event) => { if (event.key === 'Escape') closeMenus(true) }}>
    <div bind:this={menuPanel} data-part="episodes.menu" data-variant="more" data-nav-scroll-container
         class="max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card p-3 shadow-2xl"
         style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));">
      <p class="px-3 pb-2 pt-1 text-base font-black">Episode options</p>
      {@render menuItems()}
    </div>
  </div>
{/if}
{#if plan.search === 'row' || (plan.search === 'toggle' && searchOpen)}
  {@render searchField(false)}
{/if}
