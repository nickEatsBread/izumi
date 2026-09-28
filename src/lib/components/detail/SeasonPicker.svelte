<script lang="ts">
  // The season picker above the episodes (API 3 `detail.episodes.seasons`): the TV, TV short and
  // ONA entries of this title's prequel/sequel chain, in release order ("Season N"). Picking one
  // opens that title. EpisodeList renders it only for two or more seasons that include this title.
  //
  // The dropdown's list works like the episode toolbar's range list (EpisodeToolbar.svelte): it is
  // portalled to <body>, so a transformed ancestor or the right-hand rail's scroll box can neither
  // offset nor clip it, and fixed at its button in local px (menu-anchor.ts). While open it follows
  // its button, a press anywhere else closes it, the d-pad stays inside it and scrolls only the list
  // (`data-nav-scroll-container`), and Escape or B closes it and hands focus back to the button.
  import { tick } from 'svelte'
  import { cover, mediaHref } from '$lib/anilist/media'
  import type { SeasonEntry } from '$lib/anilist/seasons'
  import { reliableImage } from '$lib/util/reliable-image'
  import { portal } from '$lib/util/portal'
  import { anchoredMenuStyle, centreInList } from '$lib/components/menu-anchor'
  import * as h from '$lib/haptics'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'

  let { entries, variant, inline = false }: {
    entries: SeasonEntry[]
    variant: 'chips' | 'posters' | 'dropdown'
    /** The dropdown sits inside a heading-row toolbar (no margin of its own). */
    inline?: boolean
  } = $props()
  const current = $derived(entries.find((entry) => entry.active))
  let open = $state(false)
  let trigger = $state<HTMLButtonElement>()
  let panel = $state<HTMLElement>()
  let place = $state('')
  let track = $state<HTMLElement>()
  // Bring the current season into view on long franchises. Only the row scrolls, never the page.
  $effect(() => {
    const row = track
    const index = entries.findIndex((entry) => entry.active)
    const item = index < 0 ? undefined : (row?.children[index] as HTMLElement | undefined)
    if (row && item) row.scrollLeft = Math.max(0, item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2)
  })

  function follow() {
    if (open) place = anchoredMenuStyle(trigger, panel, 'start', 320)
  }
  /** Place the list that just opened, again once it has its real size, then focus the current
   *  season (else the first) so a controller or keyboard starts inside it. The focus moves nothing
   *  (the page behind stays put), so the list scrolls that season into view once its height cap is in. */
  async function toggleList() {
    h.tap()
    open = !open
    if (!open) return
    follow()
    await tick()
    follow()
    await tick()
    const entry = panel?.querySelector<HTMLElement>('[data-active]') ?? panel?.querySelector<HTMLElement>('[data-focusable]')
    centreInList(panel, entry)
    entry?.focus({ preventScroll: true })
  }
  /** `refocus` (Escape, B, a pick) puts focus back on the button rather than the page behind. */
  function close(refocus = false) {
    open = false
    if (refocus) trigger?.focus({ preventScroll: true })
  }
  // While the list is open it follows its button through scrolling and resizing, and a press
  // anywhere else closes it.
  $effect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel?.contains(target) && !trigger?.contains(target)) open = false
    }
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('pointerdown', outside, true)
    }
  })
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); close(true) } }} />

{#if variant === 'dropdown'}
  <div data-slot="episodes.seasons" data-variant="dropdown" class="w-fit {inline ? '' : 'mb-3'}">
    <button bind:this={trigger} type="button" data-part="season.toggle" data-open={open || undefined} data-focusable
            aria-haspopup="true" aria-expanded={open} onclick={toggleList}
            class="flex h-11 items-center gap-1.5 rounded-lg pr-2 text-base font-black">
      <ChevronDown size={18} class="transition-transform {open ? 'rotate-180' : ''}" />
      <span data-part="season.label">{current?.label ?? 'Seasons'}</span>
    </button>
    {#if open}
      <div use:portal bind:this={panel} data-part="episodes.menu" data-variant="seasons" data-nav-trap data-nav-escape style={place} data-nav-scroll-container
           class="fixed z-[60] w-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1.5 shadow-2xl">
        {#each entries as entry (entry.media.id)}
          <a data-part="season" data-active={entry.active || undefined} data-focusable href={mediaHref(entry.media)}
             aria-current={entry.active ? 'page' : undefined} onclick={() => close(true)}
             class="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold hover:bg-accent">
            <span data-part="season.label" class="flex-1">{entry.label}</span>
            {#if entry.year}<span data-part="season.year" class="text-xs font-semibold text-muted-foreground">{entry.year}</span>{/if}
            {#if entry.active}<Check size={15} class="text-theme" />{/if}
          </a>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div data-slot="episodes.seasons" data-variant={variant} bind:this={track}
       class="relative -mx-4 mb-4 flex overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 {variant === 'posters' ? 'gap-4' : 'gap-2'}">
    {#each entries as entry (entry.media.id)}
      <a data-part="season" data-active={entry.active || undefined} data-focusable href={mediaHref(entry.media)}
         aria-current={entry.active ? 'page' : undefined}
         class={variant === 'posters'
           ? `flex w-24 shrink-0 flex-col gap-2 text-center ${entry.active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`
           : `flex shrink-0 flex-col items-center rounded-xl border px-3.5 py-2 text-center transition-colors ${entry.active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/60 hover:bg-accent'}`}>
        {#if variant === 'posters'}
          <img data-part="season.art" use:reliableImage={cover(entry.media)} alt="" loading="lazy" decoding="async"
               class="aspect-[2/3] w-full rounded-lg object-cover {entry.active ? 'ring-2 ring-primary' : 'ring-1 ring-border'}" />
        {/if}
        <span data-part="season.label" class="truncate text-sm font-bold">{entry.label}</span>
        {#if variant === 'chips' && entry.year}<span data-part="season.year" class="text-[0.7rem] font-semibold opacity-75">{entry.year}</span>{/if}
      </a>
    {/each}
  </div>
{/if}
