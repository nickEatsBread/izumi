<script lang="ts">
  import type { Component } from 'svelte'

  // The theme top bar's pinned menu (`shell.top.menu: "side"`): every destination as a labelled row
  // down the left under the bar, the way a site keeps its menu open beside the page on a wide
  // window. The page moves over for it through --theme-shell-left (set by the shell).
  type Destination = { href: string; label: string; icon: Component<{ size?: number }> }
  let { items, active, width }: { items: Destination[]; active: (href: string) => boolean; width: number } = $props()
</script>

<nav data-slot="nav.panel" aria-label="Menu" data-theme-surface="shell" style:width={`${width}px`}
     class="fixed bottom-0 left-0 top-[4.75rem] z-20 flex flex-col gap-1 overflow-y-auto border-r border-border/50 bg-background p-3">
  {#each items as item (item.href)}
    {@const on = active(item.href)}
    <a data-part="nav.item" data-active={on || undefined} data-focusable href={item.href} aria-current={on ? 'page' : undefined}
       class="flex h-11 shrink-0 items-center gap-3 rounded-md px-2 text-base transition-colors hover:bg-accent {on ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/80'}">
      <span data-part="nav.item.icon" class="grid w-8 shrink-0 place-items-center"><item.icon size={22} /></span>
      <span data-part="nav.item.label" class="truncate">{item.label}</span>
    </a>
  {/each}
</nav>
