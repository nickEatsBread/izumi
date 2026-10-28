<script lang="ts">
  import type { BrowseOption } from '$lib/catalog/browse'
  import { motion } from '$lib/motion/gm-motion'
  import { gameMode, playing } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { bumperTabs } from '$lib/nav/bumpers'
  import { onPadButton } from '$lib/nav/pad-events'
  import { topNavLayer } from '$lib/nav/layers'
  import { stepPageTabs } from '$lib/nav/page-tabs'
  import { get } from 'svelte/store'

  // The sort pills. The lit pill's marker slides over from the pill that was lit (gm-motion: a CSS
  // animation elsewhere, per-frame writes in Game mode, where a CSS one blinks as it ends). The
  // strip is the page's tab strip (`data-page-tabs`): L1/R1 step it with a pad, or L2/R2 while a
  // theme's top bar owns L1/R1 (the shell steps it then).
  let { options, active, onSelect }: { options: BrowseOption[]; active: string; onSelect: (value: string) => void } = $props()

  let slideFrom = $state(0)

  function pick(value: string, event: MouseEvent) {
    if (value === active) return
    const pill = event.currentTarget as HTMLElement
    const lit = pill.parentElement?.querySelector<HTMLElement>('[data-part="browse.sort"][data-state="active"]')
    slideFrom = lit ? lit.offsetLeft - pill.offsetLeft : 0
    onSelect(value)
  }

  $effect(() => {
    if (!$gameMode && !$controllerMode) return
    return onPadButton(({ name, pressed }) => {
      if (!pressed || get(bumperTabs) || get(playing) || topNavLayer()) return
      if (name === 'l1' || name === 'r1') stepPageTabs(name === 'l1' ? -1 : 1)
    })
  })
</script>

<!-- The strip is the stacking context (`isolate`) and the pills are not, so the marker (`-z-10`)
     passes under every pill's label as it slides, whichever way it goes. -->
<div data-part="browse.sorts" data-page-tabs role="tablist" aria-label="Sort"
     class="relative isolate flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-secondary p-1 [scrollbar-width:none]">
  {#each options as option (option.value)}
    {@const on = option.value === active}
    <button type="button" role="tab" aria-selected={on} data-focusable data-part="browse.sort" data-sort={option.value}
            data-state={on ? 'active' : undefined} data-nav-id={on ? 'browse-sort' : undefined}
            onclick={(event) => pick(option.value, event)}
            class="relative flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold
                   {on ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'} {$gameMode ? '' : 'transition-colors'}">
      {#if on}
        <span data-part="browse.sort.marker" aria-hidden="true" class="absolute inset-0 -z-10 rounded-full bg-primary"
              in:motion={{ x: [slideFrom, 0], duration: 180 }}></span>
      {/if}
      {option.label}
    </button>
  {/each}
</div>
