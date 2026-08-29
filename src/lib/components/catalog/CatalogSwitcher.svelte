<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Pencil from '@lucide/svelte/icons/pencil'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import CatalogBrandLogo from './CatalogBrandLogo.svelte'
  import CatalogPlatformLogo from './CatalogPlatformLogo.svelte'
  import {
    catalogLabel,
    catalogScreen,
    enabledCatalogScreens,
    selectCatalogScreen,
    type CatalogScreen,
  } from '$lib/settings/catalog'
  import { homeEditorOpen } from '$lib/catalog/home-editor'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'

  let {
    appearance = 'overlay',
    className = '',
    align = 'start',
    display = 'value',
    expanded = false,
    showWordmark = false,
    open = $bindable(false),
  }: {
    appearance?: 'overlay' | 'surface'
    className?: string
    align?: 'start' | 'end'
    display?: 'brand' | 'icon' | 'value' | 'rail'
    /** Sidebar rail only: whether the rail is expanded, so the label can fade in/out with it. */
    expanded?: boolean
    /** Brand trigger only: include the Izumi wordmark in the clickable area (mobile Home). */
    showWordmark?: boolean
    open?: boolean
  } = $props()

  const descriptions: Record<CatalogScreen, string> = {
    merged: 'Your custom mix from every catalog',
    auto: 'Anime-first with smart metadata fallbacks',
    anilist: 'Anime discovery from AniList',
    kitsu: 'An independent anime catalog',
    tmdb: 'Movies, television, and anime',
    stremio: 'Catalogs from your metadata add-ons',
    jvm: 'Anime from installed Aniyomi sources',
  }

  let root = $state<HTMLDivElement>()
  let trigger = $state<HTMLButtonElement>()
  let listbox = $state<HTMLDivElement>()
  const choices = $derived($enabledCatalogScreens)
  const activeLabel = $derived(catalogLabel($catalogScreen))
  const canSwitch = $derived(choices.length > 1)

  async function setOpen(next: boolean, refocus = false) {
    open = next
    if (next) {
      await tick()
      const current = listbox?.querySelector<HTMLElement>('[aria-selected="true"]')
      const first = listbox?.querySelector<HTMLElement>('[role="option"]')
      ;(current ?? first)?.focus({ preventScroll: true })
    } else if (refocus) {
      await tick()
      trigger?.focus({ preventScroll: true })
    }
  }

  function choose(provider: CatalogScreen) {
    if (provider !== $catalogScreen) {
      h.tap()
      selectCatalogScreen(provider)
    }
    void setOpen(false, true)
  }

  function editHome() {
    h.tap()
    open = false
    homeEditorOpen.set(true)
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      void setOpen(true)
    }
  }

  function onListKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      void setOpen(false, true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const options = [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (!options.length) return
    if (event.key === 'Home') { options[0].focus(); return }
    if (event.key === 'End') { options.at(-1)?.focus(); return }
    const index = options.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    options[(index + step + options.length) % options.length]?.focus()
  }

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      if (open && !root?.contains(event.target as Node)) void setOpen(false)
    }
    const closeOnBlur = () => { if (open) void setOpen(false) }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('blur', closeOnBlur)
    }
  })

  // A phone picker is a modal bottom sheet. Keep the page from sliding behind it while the user
  // scrolls a longer provider list; desktop's anchored popover remains non-modal.
  $effect(() => {
    if (!open || !$isMobile) return
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
    }
  })
</script>

{#if canSwitch}
  <!-- Keep caller positioning on the outer wrapper. Combining `relative` with Home's supplied
       `absolute` class let Tailwind's generated order choose `relative`, putting this control in
       document flow and exposing a black strip above the full-bleed hero. -->
  <div bind:this={root} class={className} data-nav-trap={open ? '' : undefined}>
    <div class="relative {display === 'rail' ? 'w-full' : 'w-fit'}">
    <button
      bind:this={trigger}
      type="button"
      data-focusable
      aria-label={`Catalog: ${activeLabel}. Choose catalog`}
      title={`Catalog: ${activeLabel}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? 'catalog-switcher-options' : undefined}
      onclick={() => void setOpen(!open)}
      onkeydown={onTriggerKeydown}
      class="group relative text-left outline-none transition
        focus-visible:ring-2 focus-visible:ring-theme
        {display === 'rail'
          ? 'flex h-11 w-full shrink-0 items-center gap-3 rounded-md pl-3 text-muted-foreground hover:bg-accent hover:text-foreground'
          : display === 'brand'
          ? showWordmark
            ? 'flex min-h-10 items-center gap-2 rounded-md pr-1 hover:bg-accent/40'
            : 'grid size-10 place-items-center rounded-md hover:bg-accent/40 hover:scale-110'
          : display === 'icon'
          ? 'grid size-11 place-items-center rounded-full'
          : 'flex min-h-10 items-center gap-2 rounded-full py-1 pl-1 pr-2.5'}
        {display === 'rail' || display === 'brand'
          ? ''
          : appearance === 'overlay'
          ? 'border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/70'
          : 'border-border bg-card/90 text-foreground hover:bg-accent'}
        {display === 'rail' || display === 'brand' ? '' : 'border shadow-lg'}"
    >
      {#if display === 'rail'}
        <!-- Sidebar rail row: same anatomy as the nav links (icon slot + fading label), so it
             reads as just another destination. The tile is scaled down like the value pill's. -->
        <span class="grid w-8 shrink-0 place-items-center"><span class="-m-1 scale-75"><CatalogPlatformLogo platform={$catalogScreen} /></span></span>
        <span class="whitespace-nowrap text-sm font-semibold transition-opacity duration-150 {expanded ? 'opacity-100' : 'opacity-0'}">Catalog: {activeLabel}</span>
      {:else if display === 'brand'}
        <!-- Integrated mode keeps the identity visually intact: the full Izumi mark is the
             trigger, and a quiet chevron communicates that it opens instead of navigating. -->
        <span class="relative grid size-8 shrink-0 place-items-center">
          <CatalogBrandLogo platform={$catalogScreen} />
          <ChevronDown
            aria-hidden="true"
            size={11}
            strokeWidth={3}
            class="absolute -bottom-1 -right-1 rounded-full bg-background/85 p-px text-foreground drop-shadow-md transition-transform {open ? 'rotate-180' : ''}"
          />
        </span>
        {#if showWordmark}
          <img src="/brand/izumi-wordmark-white.svg" alt="" class="catalog-brand-wordmark h-5" draggable="false" />
        {/if}
      {:else if display === 'icon'}
        <!-- The provider tile is the button face, rather than a smaller tile floating inside a
             second dark circle. Scale it to the 44px hit area and clip its corners to the circle. -->
        <span class="grid size-11 place-items-center overflow-hidden rounded-full">
          <span class="scale-110"><CatalogPlatformLogo platform={$catalogScreen} /></span>
        </span>
      {:else}
        <span class="-m-1 scale-75"><CatalogPlatformLogo platform={$catalogScreen} /></span>
        <span class="block max-w-32 truncate text-sm font-black">{activeLabel}</span>
        <ChevronDown size={14} class="shrink-0 opacity-65 transition-transform {open ? 'rotate-180' : ''}" />
      {/if}
      {#if display === 'icon'}
        <span
          aria-hidden="true"
          class="absolute bottom-0 right-0 grid size-4 place-items-center rounded-full border border-white/15 bg-background text-foreground shadow-sm"
        >
          <ChevronDown size={10} strokeWidth={3} class="transition-transform {open ? 'rotate-180' : ''}" />
        </span>
      {/if}
    </button>

    {#if open}
      {#if $isMobile}
        <button
          type="button"
          tabindex="-1"
          aria-label="Close catalog picker"
          class="fixed inset-0 z-[69] bg-black/65"
          transition:fade={{ duration: 120 }}
          onclick={() => void setOpen(false, true)}
        ></button>
      {/if}

      <div
        role={$isMobile ? 'dialog' : undefined}
        aria-modal={$isMobile ? 'true' : undefined}
        aria-label={$isMobile ? 'Choose catalog' : undefined}
        class="z-[70] overflow-hidden border border-border bg-background text-foreground shadow-2xl
          {$isMobile
            ? 'fixed inset-x-0 bottom-0 max-h-[min(80vh,38rem)] rounded-t-3xl pb-[env(safe-area-inset-bottom)]'
            : `absolute top-[calc(100%+0.5rem)] w-[22rem] rounded-2xl ${align === 'end' ? 'right-0' : 'left-0'}`}"
        in:fly={{ y: $isMobile ? 20 : -5, duration: 150 }}
        out:fade={{ duration: 100 }}
      >
        {#if $isMobile}
          <div class="pb-1 pt-3"><div class="mx-auto h-1 w-10 rounded-full bg-foreground/20"></div></div>
        {/if}
        <div class="px-4 pb-2 pt-3">
          <h2 class="text-base font-black">Choose catalog</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">Change where Home and Search find titles.</p>
        </div>

        <div
          bind:this={listbox}
          id="catalog-switcher-options"
          role="listbox"
          tabindex="-1"
          aria-label="Catalog"
          class="max-h-[min(56vh,25rem)] space-y-1 overflow-y-auto overscroll-contain px-2 pb-2"
          onkeydown={onListKeydown}
        >
          {#each choices as provider (provider)}
            <button
              type="button"
              data-focusable
              role="option"
              aria-selected={provider === $catalogScreen}
              onclick={() => choose(provider)}
              class="flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition
                hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme
                {provider === $catalogScreen ? 'bg-theme/10' : ''}"
            >
              <CatalogPlatformLogo platform={provider} />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-black">{catalogLabel(provider)}</span>
                <span class="mt-0.5 block truncate text-xs text-muted-foreground">{descriptions[provider]}</span>
              </span>
              {#if provider === $catalogScreen}<Check size={18} class="shrink-0 text-theme" />{/if}
            </button>
          {/each}
        </div>

        <div class="border-t border-border p-2">
          <button
            type="button"
            data-focusable
            onclick={editHome}
            class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition hover:bg-theme/10 hover:text-theme focus:bg-theme/10 focus:text-theme"
          >
            <Pencil size={17} />
            <span class="flex-1">Edit this Home</span>
          </button>
          <a
            href="/app/settings/catalog"
            data-focusable
            onclick={() => { h.tap(); open = false }}
            class="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground focus:bg-accent"
          >
            <SlidersHorizontal size={17} />
            <span class="flex-1">Manage catalogs</span>
            <span aria-hidden="true">›</span>
          </a>
        </div>
      </div>
    {/if}
    </div>
  </div>
{/if}

<style>
  :global(html[data-scheme='light']) .catalog-brand-wordmark {
    filter: brightness(0) saturate(100%);
  }
</style>
