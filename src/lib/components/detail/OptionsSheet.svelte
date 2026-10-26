<script lang="ts" module>
  import type { Component } from 'svelte'
  export interface SheetOption {
    id: string
    label: string
    /** A short value or state on the right ("3 of 12 saved"). */
    detail?: string
    icon?: Component<{ size?: number }>
    disabled?: boolean
    onselect: () => void
  }
  export interface SheetGroup {
    /** A small heading over the group ("Episode 4"). */
    title?: string
    options: SheetOption[]
  }
</script>

<script lang="ts">
  import { navLayer } from '$lib/nav/overlay'
  import { motion } from '$lib/motion/gm-motion'
  import Glyph from '$lib/components/shell/Glyph.svelte'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'

  // A side menu of actions for the page under it, opened by the options (☰) button, the way the
  // player's ☰ opens its own: a panel on the right, B or a tap outside closes it.
  let { title, groups, onclose }: { title: string; groups: SheetGroup[]; onclose: () => void } = $props()
  const pad = $derived($gameMode || $controllerMode)
</script>

<div data-slot="options.sheet" class="fixed inset-0 z-[72] bg-black/55" onclick={onclose} role="presentation"
     in:motion={{ opacity: [0, 1], duration: 140 }} out:motion={{ opacity: [0, 1], duration: 120 }}>
  <div data-part="options.panel" role="dialog" aria-modal="true" aria-label={title} data-nav-trap tabindex="-1"
       use:navLayer={{ kind: 'options-sheet', onClose: onclose, initialFocus: 'always' }}
       in:motion={{ x: [48, 0], opacity: [0, 1], duration: 180 }}
       class="absolute inset-y-0 right-0 flex w-[min(30rem,90vw)] flex-col border-l border-white/10 bg-[#101012]/95 text-white shadow-2xl"
       onclick={(event) => event.stopPropagation()}>
    <h2 data-part="options.title" class="shrink-0 px-6 pb-3 pt-7 text-2xl font-bold leading-tight"><span class="line-clamp-2">{title}</span></h2>
    <div data-part="options.list" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
      {#each groups as group, g (g)}
        {#if group.options.length}
          {#if group.title}<div data-part="options.heading" class="px-4 pb-1 pt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-white/40">{group.title}</div>{/if}
          {#each group.options as option (option.id)}
            <button type="button" data-part="options.item" data-option={option.id} data-focusable disabled={option.disabled}
                    onclick={() => { if (!option.disabled) option.onselect() }}
                    class="my-0.5 flex min-h-[3.75rem] w-full select-none items-center gap-4 rounded-xl px-4 text-left text-lg font-semibold outline-none hover:bg-white/10 focus-visible:bg-white focus-visible:text-black disabled:opacity-40">
              <span data-part="options.item.icon" class="grid w-7 shrink-0 place-items-center">{#if option.icon}<option.icon size={22} />{/if}</span>
              <span data-part="options.item.label" class="min-w-0 flex-1">{option.label}</span>
              {#if option.detail}<span data-part="options.item.detail" class="max-w-[45%] truncate text-sm font-medium opacity-60">{option.detail}</span>{/if}
            </button>
          {/each}
        {/if}
      {/each}
    </div>
    {#if pad}
      <div data-part="options.hints" class="flex shrink-0 items-center gap-6 border-t border-white/10 px-6 py-3.5 text-base font-semibold text-white/65">
        <span class="flex items-center gap-2"><Glyph family="deck" button="a" />Select</span>
        <span class="flex items-center gap-2"><Glyph family="deck" button="b" />Close</span>
      </div>
    {/if}
  </div>
</div>
