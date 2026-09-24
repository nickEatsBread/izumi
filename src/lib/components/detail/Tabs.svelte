<script lang="ts">
  import * as h from '$lib/haptics'
  import { gameMode } from '$lib/player/session'
  import type { DetailTabs } from '$lib/themes/presentation'
  // `variant` comes from the theme's series page: an underlined row (stock), pills, an iOS-style
  // segmented control, or a bar of equal tabs with a tinted pill behind the active one.
  let { tabs, active = $bindable(), variant = 'underline' }: { tabs: string[]; active: string; variant?: DetailTabs } = $props()
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

<div data-theme-tabs={variant} class="-mx-4 mb-4 flex overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0
  {variant === 'underline' ? 'gap-1 border-b border-border' : ''}
  {variant === 'pills' ? 'gap-2' : ''}
  {variant === 'segmented' ? 'gap-1 rounded-xl bg-secondary p-1 sm:w-fit' : ''}
  {variant === 'bar' ? 'gap-1 rounded-2xl bg-secondary/60 p-1' : ''}">
  {#each tabs as tab (tab)}
    <button
      data-focusable
      onclick={(event) => pick(tab, event)}
      class="relative shrink-0 whitespace-nowrap text-sm font-bold transition-all duration-100 active:scale-95
        {variant === 'underline' ? `rounded-t-md px-3 py-2.5 sm:px-4 sm:py-2 ${active === tab ? 'text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground active:bg-secondary'}` : ''}
        {variant === 'pills' ? `rounded-full px-4 py-2 ${active === tab ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}` : ''}
        {variant === 'segmented' ? `rounded-lg px-4 py-1.5 ${active === tab ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}` : ''}
        {variant === 'bar' ? `flex-1 rounded-xl px-3 py-2.5 text-center ${active === tab ? 'bg-theme/15 text-theme' : 'text-muted-foreground hover:text-foreground'}` : ''}"
    >
      {tab}
      {#if active === tab && variant === 'underline'}
        <span class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"></span>
      {/if}
    </button>
  {/each}
</div>
