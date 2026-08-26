<script lang="ts">
  import { onMount, tick } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'
  import { isMobile } from '$lib/platform'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import { menuPlacement } from '$lib/components/menu-placement'

  export type SelectOption = {
    value: string
    label: string
    disabled?: boolean
  }

  let {
    value = $bindable(),
    options,
    onChange,
    className = '',
    ariaLabel,
  }: {
    value: string
    options: SelectOption[]
    onChange?: (value: string) => void
    className?: string
    ariaLabel?: string
  } = $props()

  let root: HTMLDivElement
  let trigger: HTMLButtonElement
  let open = $state(false)
  const selected = $derived(options.find((option) => option.value === value) ?? options[0])

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
  }

  async function setOpen(next: boolean) {
    if (next) measure()
    open = next
    if (!next) return
    await tick()
    // Now that it exists, re-decide against the real content height rather than the estimate.
    measure(menu?.scrollHeight)
    const current = root.querySelector<HTMLElement>(`[data-select-value="${CSS.escape(value)}"]`)
    const first = root.querySelector<HTMLElement>('[data-select-value]:not(:disabled)')
    ;(current ?? first)?.focus({ preventScroll: true })
  }

  function choose(option: SelectOption) {
    if (option.disabled) return
    if (onChange) onChange(option.value)
    else value = option.value
    open = false
    trigger.focus({ preventScroll: true })
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      void setOpen(true)
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      open = false
      trigger.focus({ preventScroll: true })
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-select-value]:not(:disabled)')]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(current + step + items.length) % items.length]?.focus({ preventScroll: true })
  }

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
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
  {#each options as option (option.value)}
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
      <span class="truncate">{option.label}</span>
      {#if option.value === value}<Check size={15} class="shrink-0 text-primary" />{/if}
    </button>
  {/each}
{/snippet}

<div bind:this={root} class="relative {className}" data-nav-trap={open ? '' : undefined}>
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
    <span class="truncate">{selected?.label ?? value}</span>
    <ChevronDown size={15} class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </button>

  {#if open}
    {#if $isMobile}
      <!-- Mobile: a viewport-anchored sheet (same pattern as MultiSelect). The absolutely-positioned
           desktop dropdown reads as a desktop widget on a phone and can be clipped by a narrow
           parent; the fixed panel gets the full width minus margins. -->
      <div
        bind:this={menu}
        role="listbox"
        tabindex="-1"
        aria-label={ariaLabel}
        class="fixed left-3 right-3 z-[80] overflow-y-auto overscroll-contain rounded-md border border-border bg-background p-1 text-foreground shadow-xl"
        style="{placement === 'down' ? `top:${panelTop}px` : `bottom:${panelBottom}px`};max-height:{maxHeight}px"
        onkeydown={onMenuKeydown}
      >
        {@render optionList()}
      </div>
    {:else}
      <div
        bind:this={menu}
        role="listbox"
        tabindex="-1"
        aria-label={ariaLabel}
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
