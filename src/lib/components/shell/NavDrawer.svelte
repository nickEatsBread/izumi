<script lang="ts">
  import type { Component, Snippet } from 'svelte'
  import { motion } from '$lib/motion/gm-motion'
  import X from '@lucide/svelte/icons/x'

  // Every destination in a drawer from the left (the theme top bar's `menu: "drawer"`, or the whole
  // navigation with `shell.nav: "drawer"`, which adds a head, a section after the destinations and a
  // foot, slides the full width in and closes on Right).
  // `id` is the destination's `data-dest` (`home`, `schedule`, `settings`, …).
  type Destination = { id: string; href: string; label: string; icon: Component<{ size?: number }> }
  let { open = $bindable(false), items, active, head, after, foot, slide = 24, duration = 160, closeOnRight = false }: {
    open: boolean; items: Destination[]; active: (href: string) => boolean
    head?: Snippet; after?: Snippet; foot?: Snippet; slide?: number; duration?: number; closeOnRight?: boolean
  } = $props()

  let panel = $state<HTMLElement>()
  // Opens on the page you are on, so a pad press lands next to it, not on the close button.
  $effect(() => {
    if (open) (panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel?.querySelector<HTMLElement>('a, button'))?.focus({ preventScroll: true })
  })
  function onKeydown(event: KeyboardEvent) {
    if (!open) return
    if (event.key === 'Escape') open = false
    else if (closeOnRight && event.key === 'ArrowRight') {
      // A row in the foot (account, settings) takes Right to its next control first. A controller's
      // keys are sent to the window, so the focused control is the one Right starts from.
      const from = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const row = from?.closest('[data-part="nav.drawer.foot"]')
      const controls = row ? [...row.querySelectorAll<HTMLElement>('[data-focusable]')] : []
      if (controls.length && controls.at(-1) !== from) return
      event.preventDefault()
      event.stopImmediatePropagation()
      open = false
    }
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#if open}
  <!-- Script-driven in Game mode (gm-motion): a CSS slide there blinks the drawer away as it ends. -->
  <button type="button" tabindex="-1" aria-label="Close menu" onclick={() => (open = false)} class="fixed inset-0 z-[70] bg-black/60" in:motion={{ opacity: [0, 1], duration: 120 }} out:motion={{ opacity: [0, 1], duration: 120 }}></button>
  <div bind:this={panel} data-slot="nav.drawer" role="dialog" aria-modal="true" aria-label="Menu" data-nav-trap data-nav-escape class="fixed inset-y-0 left-0 z-[71] flex w-72 flex-col border-r border-border bg-background p-3 pt-10 shadow-2xl" in:motion={{ x: [-slide, 0], duration }} out:motion={{ x: [-slide, 0], duration }}>
    {#if head}{@render head()}{:else}
      <button type="button" data-focusable aria-label="Close menu" onclick={() => (open = false)} class="mb-2 grid size-10 shrink-0 place-items-center self-end rounded-lg hover:bg-accent"><X size={20} /></button>
    {/if}
    <!-- The list scrolls between the head and the foot, which stay put. -->
    <div data-part="nav.drawer.list" class="-mx-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
    {#each items as item (item.href)}
      {@const on = active(item.href)}
      <a data-part="nav.item" data-dest={item.id} data-active={on || undefined} data-focusable href={item.href} aria-current={on ? 'page' : undefined} onclick={() => (open = false)}
        class="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent {on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}">
        <span data-part="nav.item.icon" class="grid w-6 place-items-center"><item.icon size={19} /></span>
        <span data-part="nav.item.label">{item.label}</span>
      </a>
    {/each}
    {@render after?.()}
    </div>
    {@render foot?.()}
  </div>
{/if}
