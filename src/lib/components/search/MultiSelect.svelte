<script lang="ts">
  // A compact multi-select dropdown: a labelled button showing the selection count, opening a
  // checklist panel. Closes on outside-click / Escape. On mobile the panel is viewport-anchored
  // (fixed, full width minus margins) so a right-edge trigger's list can't overflow off-screen.
  import ChevronDown from 'lucide-svelte/icons/chevron-down'
  import Check from 'lucide-svelte/icons/check'
  import { isMobile } from '$lib/platform'

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
  let panelTop = $state(0)
  const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

  function toggleOpen() {
    open = !open
    if (open && root) panelTop = root.getBoundingClientRect().bottom + 4
  }
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

{#snippet optionList()}
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
{/snippet}

<div bind:this={root} class="relative shrink-0">
  <button
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
      <div class="fixed left-3 right-3 z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl" style="top:{panelTop}px">
        {@render optionList()}
      </div>
    {:else}
      <div class="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl">
        {@render optionList()}
      </div>
    {/if}
  {/if}
</div>
