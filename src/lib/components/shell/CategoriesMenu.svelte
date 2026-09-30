<script lang="ts">
  // Theme top bar `categories` (API 3): a Categories menu with browse links and the catalog's genres,
  // the way streaming sites group them in their header. A genre opens search filtered to it.
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { page } from '$app/state'
  import { portal } from '$lib/util/portal'
  import { isOskTarget } from '$lib/nav/osk'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import { loadGenres } from '$lib/home/genres'
  import { catalogProviders, catalogScreen } from '$lib/settings/catalog'
  import { showAdult } from '$lib/settings/ui'
  import { browseAllHref, categoriesCatalog, categoriesPanelPlace, genreHref } from './categories'

  let { focusable = true, tabindex }: { focusable?: boolean; tabindex?: number } = $props()
  let open = $state(false)
  let trigger = $state<HTMLButtonElement>()
  let panel = $state<HTMLElement>()
  let place = $state({ left: 0, top: 0 })
  let genres = $state<string[] | null>(null)
  // What the links browse: the catalog on screen, or on a Merged screen the catalog its search can
  // filter in (categories.ts).
  const target = $derived(categoriesCatalog($catalogScreen, $catalogProviders))
  // Plain latch, not $state: the catalog whose genres were last requested. A failed or empty load
  // clears it, so the next open asks again.
  let requested = ''

  function ensureGenres() {
    const catalog = target.catalog
    if (requested === catalog) return
    requested = catalog
    genres = null
    loadGenres(catalog)
      .then((list) => {
        if (requested !== catalog) return
        genres = list
        if (!list.length) requested = ''
      })
      .catch(() => {
        if (requested !== catalog) return
        genres = []
        requested = ''
      })
  }
  // The adult genre only shows where 18+ titles are switched on (and the profile allows them).
  const shown = $derived((genres ?? []).filter((genre) => $showAdult || genre.toLowerCase() !== 'hentai'))

  function toggle() {
    if (open) { open = false; return }
    ensureGenres()
    open = true
  }
  // The panel is fixed and portalled to <body>. It sits under the button and slides left until its
  // real width fits the window: the genre grid (and a theme's styling of it) decides that width,
  // and it grows once the genres arrive. Positions are divided by the UI-scale zoom the same way
  // the card popup's are (preview-pos.ts).
  $effect(() => {
    const node = panel
    if (!open || !node) return
    const measure = () => {
      const box = trigger?.getBoundingClientRect()
      if (box) place = categoriesPanelPlace(box, node.getBoundingClientRect().width, window.innerWidth, rootZoom())
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  })
  // Like the menu drawer: opening moves focus into the panel, whose focus trap then keeps the
  // D-pad inside it, and B closes it the way Escape does (data-nav-trap, data-nav-escape).
  $effect(() => {
    if (open) panel?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true })
  })
  // Any navigation closes the menu, including one of its own links.
  $effect(() => {
    void page.url.href
    open = false
  })
  function onPointerDown(event: PointerEvent) {
    // A tap on the on-screen keyboard is typing, not a press outside.
    if (isOskTarget(event.target)) return
    if (!open) return
    const hit = event.target as Node
    if (panel?.contains(hit) || trigger?.contains(hit)) return
    open = false
  }
  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      open = false
      trigger?.focus({ preventScroll: true })
    }
  }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeydown} />

<button bind:this={trigger} type="button" data-part="nav.item" data-variant="menu" data-active={open || undefined}
        data-focusable={focusable ? '' : undefined} {tabindex} aria-expanded={open} onclick={toggle}
        class="group relative inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-foreground {open ? 'text-foreground' : 'text-muted-foreground'}">
  <span data-part="nav.item.label">Categories</span>
  <ChevronDown size={16} class="transition-transform duration-150 {open ? 'rotate-180' : ''}" />
</button>

{#if open}
  <!-- A labelled panel of links, not an ARIA menu (its arrow-key model is not implemented). -->
  <nav use:portal bind:this={panel} data-slot="nav.categories" aria-label="Categories" data-nav-trap data-nav-escape
       class="fixed z-50 flex max-h-[70vh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-b-lg border border-border bg-card text-card-foreground shadow-2xl"
       style={`left:${place.left}px;top:${place.top}px`}>
    <div class="flex w-56 shrink-0 flex-col py-2">
      <a data-part="nav.categories.link" data-focusable href={browseAllHref(target)} class="px-4 py-3 text-base hover:bg-accent">Browse all</a>
      <a data-part="nav.categories.link" data-focusable href="/app/schedule" class="px-4 py-3 text-base hover:bg-accent">Release calendar</a>
    </div>
    <div class="min-w-0 border-l border-border py-2">
      <div data-part="nav.categories.heading" class="px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Genres</div>
      {#if genres === null}
        <div class="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
      {:else if !shown.length}
        <div class="px-4 py-3 text-sm text-muted-foreground">No genres available</div>
      {:else}
        <div class="grid grid-cols-3">
          {#each shown as genre (genre)}
            <a data-part="nav.categories.link" data-variant="genre" data-focusable href={genreHref(target, genre)}
               class="w-52 px-4 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{genre}</a>
          {/each}
        </div>
      {/if}
    </div>
  </nav>
{/if}
