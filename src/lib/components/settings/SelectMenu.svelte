<script lang="ts">
  import { onMount, tick } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'
  import { isOskTarget, openOskForField } from '$lib/nav/osk'
  import { isMobile, isTv } from '$lib/platform'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { navLayer } from '$lib/nav/overlay'
  import type { NavLayerCloseReason } from '$lib/nav/layers'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import { menuPlacement } from '$lib/components/menu-placement'
  import { triggerOpensOnKey } from '$lib/nav'

  export type SelectOption = {
    value: string
    label: string
    /** Muted secondary text after the label (a score's descriptor, a unit), also echoed in the trigger. */
    description?: string
    disabled?: boolean
  }

  let {
    value = $bindable(),
    options,
    onChange,
    className = '',
    ariaLabel,
    searchable = false,
    floating = false,
    separator = '·',
    columns = false,
  }: {
    value: string
    options: SelectOption[]
    onChange?: (value: string) => void
    className?: string
    ariaLabel?: string
    searchable?: boolean
    /** Render the desktop menu viewport-fixed instead of absolutely inside the trigger's parent.
     *  For a select that lives inside a scrolling or overflow-clipped container (a dialog body, a
     *  popover), where the absolute menu would be cut off at the container edge. */
    floating?: boolean
    /** Glyph between the selected label and its description in the trigger; '' = just a gap. */
    separator?: string
    /** Short labels (e.g. numbers) in a fixed right-aligned column, with the description at full
     *  size beside them — for menus where the description IS the meaning, not a footnote. */
    columns?: boolean
  } = $props()

  let root: HTMLDivElement
  let trigger: HTMLButtonElement
  let open = $state(false)
  let query = $state('')
  let searchInput = $state<HTMLInputElement>()
  const filteredOptions = $derived(options.filter(option => !query || `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())))
  const selected = $derived(options.find((option) => option.value === value) ?? options[0])
  // A controller user opens onto the current option, not the search box: the d-pad walks the list,
  // and typing needs the on-screen keyboard anyway.
  const controllerUi = $derived($gameMode || $isTv || $controllerMode)

  // Placement: a menu anchored below a trigger that sits low on the screen used to run straight off
  // the bottom, unreachable, with no page scroll to bring it back. menuPlacement flips it up and
  // caps its height to the room on whichever side it chose (see that module for the zoom caveat).
  let menu = $state<HTMLDivElement>()
  let placement = $state<'down' | 'up'>('down')
  let maxHeight = $state(260)
  // Viewport offsets in LOCAL px for the fixed mobile panel (same pattern as MultiSelect): the
  // anchored dropdown reads as a desktop widget on a phone, so mobile gets a near-full-width sheet
  // hanging off the trigger's screen position instead.
  const GAP = 4
  let panelTop = $state(0)
  let panelBottom = $state(0)
  // The floating desktop panel keeps the trigger's own horizontal footprint.
  let panelLeft = $state(0)
  let panelWidth = $state(0)

  /** @param content the menu's natural height in local px, once it has rendered. */
  function measure(content?: number) {
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const zoom = rootZoom()
    const fit = menuPlacement({
      top: rect.top,
      bottom: rect.bottom,
      viewport: window.innerHeight,
      zoom,
      content,
    })
    placement = fit.side
    maxHeight = fit.maxHeight
    panelTop = rect.bottom / zoom + GAP
    panelBottom = window.innerHeight / zoom - rect.top / zoom + GAP
    panelLeft = rect.left / zoom
    panelWidth = rect.width / zoom
  }

  async function setOpen(next: boolean) {
    if (next) { query = ''; measure() }
    open = next
    if (!next) return
    await tick()
    // Now that it exists, re-decide against the real content height rather than the estimate.
    measure(menu?.scrollHeight)
    const current = root.querySelector<HTMLElement>(`[data-select-value="${CSS.escape(value)}"]`)
    const first = root.querySelector<HTMLElement>('[data-select-value]:not(:disabled)')
    ;(searchable && !controllerUi ? searchInput : current ?? first)?.focus({ preventScroll: true })
    // Decision 7: the searchable language menu is a typing-only launcher, so a controller gets the
    // built-in keyboard for its search at once. A no-op for mouse, touch and keyboard users.
    if (searchable && searchInput) openOskForField(searchInput)
  }

  function choose(option: SelectOption) {
    if (option.disabled) return
    if (onChange) onChange(option.value)
    else value = option.value
    open = false
    trigger.focus({ preventScroll: true })
  }

  /** The open list is a nav layer (use:navLayer on each panel below): the shared Escape capture, B
   *  and remote Back close it alone, never a dialog around it. Back puts focus on the trigger, as
   *  Escape always did; a navigation or a preempting prompt just closes it. */
  function closeMenu(reason: NavLayerCloseReason) {
    open = false
    if (reason === 'back') trigger.focus({ preventScroll: true })
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    // Owner decision 2: keyboard arrows that just landed on this trigger walk on past it (the nav
    // engine moves focus). Enter, Space or a click opens it; a trigger focused any other way opens
    // on its arrows as before. The decision is shared with CatalogSwitcher ($lib/nav).
    if (triggerOpensOnKey(event)) {
      event.preventDefault()
      void setOpen(true)
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    // Escape never gets here: the nav layer's window capture closes this menu first (closeMenu), so
    // an enclosing dialog's own Escape handler never sees it either.
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    // This handler moves focus itself; stop the arrow here so the d-pad engine's window listener
    // does not move it a second time.
    event.stopPropagation()
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-select-value]:not(:disabled)')]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(current + step + items.length) % items.length]?.focus({ preventScroll: true })
  }

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      // A tap on the on-screen keyboard types into this menu's search; it is not a press outside.
      if (isOskTarget(event.target)) return
      if (open && !root.contains(event.target as Node)) open = false
    }
    const closeOnBlur = () => { open = false }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', closeOnBlur)
    }
  })

  // The trigger moves under an open menu when the page scrolls (including the scroll the keyboard
  // shoves the view up by on Android), so re-decide the side rather than leave it stale.
  $effect(() => {
    if (!open) return
    const remeasure = () => measure(menu?.scrollHeight)
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
  })
</script>

{#snippet optionList()}
  {#if searchable}
    <input bind:this={searchInput} bind:value={query} type="search" data-focusable aria-label={`Search ${ariaLabel ?? 'options'}`} placeholder="Search languages…" class="sticky top-0 mb-1 w-full rounded-md border border-border bg-background px-3 py-3 text-sm outline-none focus:border-foreground" />
  {/if}
  <!-- Conditional listbox is programmatically focusable only; never a positive tab stop. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div role={searchable ? 'listbox' : undefined} aria-label={searchable ? ariaLabel : undefined} tabindex={searchable ? -1 : undefined}>
  {#each filteredOptions as option (option.value)}
    <button
      type="button"
      data-focusable
      data-select-value={option.value}
      role="option"
      aria-selected={option.value === value}
      disabled={option.disabled}
      class="flex w-full items-center justify-between gap-4 whitespace-nowrap rounded px-3 py-3 text-left text-base hover:bg-accent focus:bg-accent disabled:opacity-40 sm:py-2 sm:text-sm"
      onclick={() => choose(option)}
    >
      <span class="flex min-w-0 items-baseline gap-2">
        <span class="truncate {columns ? 'w-6 shrink-0 text-right font-bold tabular-nums' : ''}">{option.label}</span>
        {#if option.description}<span class="truncate text-muted-foreground {columns ? 'ml-1' : 'text-xs'}">{option.description}</span>{/if}
      </span>
      {#if option.value === value}<Check size={15} class="shrink-0 text-primary" />{/if}
    </button>
  {/each}
  </div>
  {#if !filteredOptions.length}<p role="status" class="px-3 py-4 text-sm text-muted-foreground">No matching language</p>{/if}
{/snippet}

<div bind:this={root} class="relative {className}">
  <button
    bind:this={trigger}
    type="button"
    data-focusable
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={open}
    class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md bg-input px-3 py-2.5 text-left text-base sm:min-h-0 sm:py-2 sm:text-sm"
    onclick={() => void setOpen(!open)}
    onkeydown={onTriggerKeydown}
  >
    <span class="truncate">{selected?.label ?? value}{#if selected?.description}<span class="ml-1.5 text-muted-foreground">{#if separator}<span class="mr-1.5">{separator}</span>{/if}{selected.description}</span>{/if}</span>
    <ChevronDown size={15} class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </button>

  {#if open}
    {#if $isMobile}
      <!-- Mobile: a viewport-anchored sheet (same pattern as MultiSelect). The absolutely-positioned
           desktop dropdown reads as a desktop widget on a phone and can be clipped by a narrow
           parent; the fixed panel gets the full width minus margins. -->
      <div
        bind:this={menu}
        role={searchable ? 'dialog' : 'listbox'}
        tabindex="-1"
        aria-label={ariaLabel}
        data-nav-trap
        data-nav-escape
        data-nav-scroll-container
        use:navLayer={{ kind: 'select-menu', onClose: closeMenu, initialFocus: 'none', returnFocus: 'none' }}
        class="fixed left-3 right-3 z-[80] overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1 text-foreground shadow-xl"
        style="{placement === 'down' ? `top:${panelTop}px` : `bottom:${panelBottom}px`};max-height:{maxHeight}px"
        onkeydown={onMenuKeydown}
      >
        {@render optionList()}
      </div>
    {:else if floating}
      <!-- Desktop, but escaping an overflow-clipped parent: same geometry as the absolute menu,
           expressed in viewport coordinates so a dialog body's scroll box cannot cut it off. -->
      <div
        bind:this={menu}
        role={searchable ? 'dialog' : 'listbox'}
        tabindex="-1"
        aria-label={ariaLabel}
        data-nav-trap
        data-nav-escape
        data-nav-scroll-container
        use:navLayer={{ kind: 'select-menu', onClose: closeMenu, initialFocus: 'none', returnFocus: 'none' }}
        class="fixed z-[80] overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1 text-foreground shadow-xl"
        style="left:{panelLeft}px;min-width:{panelWidth}px;{placement === 'down' ? `top:${panelTop}px` : `bottom:${panelBottom}px`};max-height:{maxHeight}px"
        onkeydown={onMenuKeydown}
      >
        {@render optionList()}
      </div>
    {:else}
      <div
        bind:this={menu}
        role={searchable ? 'dialog' : 'listbox'}
        tabindex="-1"
        aria-label={ariaLabel}
        data-nav-trap
        data-nav-escape
        data-nav-scroll-container
        use:navLayer={{ kind: 'select-menu', onClose: closeMenu, initialFocus: 'none', returnFocus: 'none' }}
        class="absolute left-0 z-[80] min-w-full overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1 text-foreground shadow-xl
          {placement === 'down' ? 'top-[calc(100%+0.25rem)]' : 'bottom-[calc(100%+0.25rem)]'}"
        style="max-height:{maxHeight}px"
        onkeydown={onMenuKeydown}
      >
        {@render optionList()}
      </div>
    {/if}
  {/if}
</div>
