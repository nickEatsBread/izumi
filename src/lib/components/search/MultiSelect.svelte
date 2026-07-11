<script lang="ts">
  // A compact multi-select dropdown: a labelled button showing
  // the selection count, opening a checklist panel. Closes on outside-click / Escape.
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import Check from 'lucide-svelte/icons/check'

  let {
    label, options, selected = [], onchange,
  }: {
    label: string
    options: string[]
    selected?: string[]
    onchange: (v: string[]) => void
  } = $props()

  let open = $state(false)
  let root = $state<HTMLElement>()
  const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

  function toggle(o: string) {
    onchange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])
  }

  $effect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (root && !root.contains(e.target as Node)) open = false }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  })
</script>

<div bind:this={root} class="relative">
  <button
    data-focusable
    onclick={() => (open = !open)}
    class="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-accent"
  >
    <span class={selected.length ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
      {label}{selected.length ? ` · ${selected.length}` : ''}
    </span>
    <ChevronDown size={14} class="text-muted-foreground transition-transform {open ? 'rotate-180' : ''}" />
  </button>
  {#if open}
    <!-- Mobile: center the panel under the trigger and cap its width to the viewport so a
         right-side select's checklist can't overflow off-screen (body clips overflow-x). -->
    <div class="absolute left-1/2 top-full z-50 mt-1 max-h-72 w-56 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl sm:left-0 sm:translate-x-0">
      {#each options as o (o)}
        {@const on = selected.includes(o)}
        <button
          data-focusable
          onclick={() => toggle(o)}
          class="flex w-full items-center gap-2 rounded px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent sm:py-1.5"
        >
          <span class="grid size-4 shrink-0 place-items-center rounded border {on ? 'border-theme bg-theme text-white' : 'border-muted-foreground/40'}">
            {#if on}<Check size={11} strokeWidth={3} />{/if}
          </span>
          <span class="truncate">{pretty(o)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
