<script lang="ts">
  import { onMount, tick } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'

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

  async function setOpen(next: boolean) {
    open = next
    if (!next) return
    await tick()
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
</script>

<div bind:this={root} class="relative {className}" data-nav-trap={open ? '' : undefined}>
  <button
    bind:this={trigger}
    type="button"
    data-focusable
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={open}
    class="flex w-full items-center justify-between gap-3 rounded-md bg-input px-3 py-2 text-left text-sm"
    onclick={() => void setOpen(!open)}
    onkeydown={onTriggerKeydown}
  >
    <span class="truncate">{selected?.label ?? value}</span>
    <ChevronDown size={15} class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </button>

  {#if open}
    <div
      role="listbox"
      tabindex="-1"
      aria-label={ariaLabel}
      class="absolute left-0 top-[calc(100%+0.25rem)] z-[80] min-w-full overflow-hidden rounded-md border border-border bg-background p-1 text-foreground shadow-xl"
      onkeydown={onMenuKeydown}
    >
      {#each options as option (option.value)}
        <button
          type="button"
          data-focusable
          data-select-value={option.value}
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          class="flex w-full items-center justify-between gap-4 whitespace-nowrap rounded px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent disabled:opacity-40"
          onclick={() => choose(option)}
        >
          <span>{option.label}</span>
          {#if option.value === value}<Check size={15} class="shrink-0 text-primary" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
