<script lang="ts">
  import { activeThemeKey, activeThemeLayout, activeThemeName, offeredThemeLayout, setThemeLayoutEnabled } from '$lib/themes/layout-state'

  // "Use <Theme> layout" switch plus "Customize a copy", for surfaces a theme layout can arrange.
  // `what` names the surface ("Home", "navigation"); `oncopy` forks the theme's version into the user's.
  let { what, oncopy }: { what: string; oncopy: () => void } = $props()
  const on = $derived(!!$activeThemeLayout)
</script>

{#if $offeredThemeLayout && $activeThemeKey}
  <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 p-3 text-sm">
    <button type="button" role="switch" aria-checked={on} data-focusable onclick={() => setThemeLayoutEnabled($activeThemeKey!, !on)}
      class="relative h-6 w-11 shrink-0 rounded-full transition {on ? 'bg-theme' : 'bg-secondary'}">
      <span class="absolute top-0.5 size-5 rounded-full bg-white shadow transition-all {on ? 'left-[1.375rem]' : 'left-0.5'}"></span>
      <span class="sr-only">Use {$activeThemeName} layout</span>
    </button>
    <span class="min-w-0 flex-1">
      <span class="block font-black">Use {$activeThemeName} layout</span>
      <span class="block text-xs text-muted-foreground">{on ? `The theme arranges your ${what}. Turn this off to use yours, or customize a copy.` : `Showing your own ${what}.`}</span>
    </span>
    {#if on}
      <button type="button" data-focusable onclick={oncopy} class="min-h-9 rounded-lg bg-secondary px-3 font-bold hover:bg-accent">Customize a copy</button>
    {/if}
  </div>
{/if}
