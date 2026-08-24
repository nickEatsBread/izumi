<script lang="ts">
  import * as h from '$lib/haptics'
  import { gameMode } from '$lib/player/session'
  let { tabs, active = $bindable() }: { tabs: string[]; active: string } = $props()
  // A press gives a haptic tick + a quick scale-down (the "button" feel of native Material tabs).
  function pick(tab: string, event: MouseEvent) {
    if (tab !== active) { h.tap(); active = tab }
    // WebKitGTK/Gamescope turns a Deck finger tap into a mouse-flavoured click and leaves the
    // button focused. Our Game-mode CSS intentionally draws focus (for the d-pad), so that stale
    // focus looked like a permanently selected second tab. A controller activation is generated
    // by HTMLElement.click() and has detail=0; only a physical pointer click is released here.
    if ($gameMode && event.detail > 0) {
      const button = event.currentTarget as HTMLButtonElement
      requestAnimationFrame(() => button.blur())
    }
  }
</script>
<div class="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
  {#each tabs as tab (tab)}
    <button
      data-focusable
      onclick={(event) => pick(tab, event)}
      class="relative shrink-0 whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm font-bold transition-all duration-100 active:scale-95 sm:px-4 sm:py-2
        {active === tab ? 'text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground active:bg-secondary'}"
    >
      {tab}
      {#if active === tab}
        <span class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"></span>
      {/if}
    </button>
  {/each}
</div>
