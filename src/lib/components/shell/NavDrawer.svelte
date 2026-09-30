<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import type { Component } from 'svelte'
  import X from '@lucide/svelte/icons/x'

  // Every destination in a drawer from the left (the theme top bar's `menu: "drawer"`).
  type Destination = { href: string; label: string; icon: Component<{ size?: number }> }
  let { open = $bindable(false), items, active }: { open: boolean; items: Destination[]; active: (href: string) => boolean } = $props()

  let panel = $state<HTMLElement>()
  // Opens on the page you are on, so a pad press lands next to it, not on the close button.
  $effect(() => {
    if (open) (panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel?.querySelector<HTMLElement>('a, button'))?.focus({ preventScroll: true })
  })
  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <button type="button" tabindex="-1" aria-label="Close menu" onclick={() => (open = false)} class="fixed inset-0 z-[70] bg-black/60" transition:fade={{ duration: 120 }}></button>
  <div bind:this={panel} data-slot="nav.drawer" role="dialog" aria-modal="true" aria-label="Menu" data-nav-trap data-nav-escape class="fixed inset-y-0 left-0 z-[71] flex w-72 flex-col gap-1 border-r border-border bg-background p-3 pt-10 shadow-2xl" transition:fly={{ x: -24, duration: 160 }}>
    <button type="button" data-focusable aria-label="Close menu" onclick={() => (open = false)} class="mb-2 grid size-10 place-items-center self-end rounded-lg hover:bg-accent"><X size={20} /></button>
    {#each items as item (item.href)}
      {@const on = active(item.href)}
      <a data-part="nav.item" data-active={on || undefined} data-focusable href={item.href} aria-current={on ? 'page' : undefined} onclick={() => (open = false)}
        class="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent {on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}">
        <span data-part="nav.item.icon" class="grid w-6 place-items-center"><item.icon size={19} /></span>
        <span data-part="nav.item.label">{item.label}</span>
      </a>
    {/each}
  </div>
{/if}
