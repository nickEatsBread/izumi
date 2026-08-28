<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import CatalogPlatformLogo from './CatalogPlatformLogo.svelte'
  import {
    catalogLabel,
    catalogProvider,
    enabledCatalogProviders,
    selectCatalogProvider,
    type CatalogSelection,
  } from '$lib/settings/catalog'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'

  let {
    appearance = 'overlay',
    className = '',
    align = 'start',
  }: {
    appearance?: 'overlay' | 'surface'
    className?: string
    align?: 'start' | 'end'
  } = $props()

  const descriptions: Record<CatalogSelection, string> = {
    auto: 'Anime-first, with automatic metadata fallbacks',
    anilist: 'Anime discovery from AniList',
    kitsu: 'An independent anime catalog',
    tmdb: 'Movies, television, and anime',
    stremio: 'Catalogs from your metadata add-ons',
    jvm: 'Anime from installed Aniyomi sources',
  }

  let root = $state<HTMLDivElement>()
  let trigger = $state<HTMLButtonElement>()
  let listbox = $state<HTMLDivElement>()
  let open = $state(false)
  const choices = $derived($enabledCatalogProviders)
  const activeLabel = $derived(catalogLabel($catalogProvider))
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

  function choose(provider: CatalogSelection) {
    if (provider !== $catalogProvider) {
      h.tap()
      selectCatalogProvider(provider)
    }
    void setOpen(false, true)
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
  <div bind:this={root} class="relative {className}" data-nav-trap={open ? '' : undefined}>
    <button
      bind:this={trigger}
      type="button"
      data-focusable
      aria-label={`Catalog: ${activeLabel}. Choose catalog`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? 'catalog-switcher-options' : undefined}
      onclick={() => void setOpen(!open)}
      onkeydown={onTriggerKeydown}
      class="group flex min-h-11 items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-3 text-left shadow-lg outline-none transition
        focus-visible:ring-2 focus-visible:ring-theme
        {appearance === 'overlay'
          ? 'border-white/15 bg-black/55 text-white backdrop-blur-md hover:bg-black/70'
          : 'border-border bg-card/90 text-foreground hover:bg-accent'}"
    >
      <span class="-m-1 scale-75"><CatalogPlatformLogo platform={$catalogProvider} /></span>
      <span class="min-w-0 leading-tight">
        <span class="block text-[0.62rem] font-extrabold uppercase tracking-[0.14em] opacity-55">Catalog</span>
        <span class="block max-w-32 truncate text-sm font-black">{activeLabel}</span>
      </span>
      <ChevronDown size={15} class="ml-1 shrink-0 opacity-65 transition-transform {open ? 'rotate-180' : ''}" />
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
              aria-selected={provider === $catalogProvider}
              onclick={() => choose(provider)}
              class="flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition
                hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme
                {provider === $catalogProvider ? 'bg-theme/10' : ''}"
            >
              <CatalogPlatformLogo platform={provider} />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-black">{catalogLabel(provider)}</span>
                <span class="mt-0.5 block truncate text-xs text-muted-foreground">{descriptions[provider]}</span>
              </span>
              {#if provider === $catalogProvider}<Check size={18} class="shrink-0 text-theme" />{/if}
            </button>
          {/each}
        </div>

        <div class="border-t border-border p-2">
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
{/if}
