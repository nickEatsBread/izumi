<script lang="ts">
  // Theme top bar `categories` (API 3): a Categories menu with browse links and the catalog's genres,
  // the way streaming sites group them in their header. A genre opens search filtered to it.
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { get } from 'svelte/store'
  import { page } from '$app/state'
  import { portal } from '$lib/util/portal'
  import { rootZoom } from '$lib/components/cards/preview-pos'
  import { loadGenres } from '$lib/home/genres'
  import { catalogScreen } from '$lib/settings/catalog'
  import { showAdult } from '$lib/settings/ui'

  let { focusable = true, tabindex }: { focusable?: boolean; tabindex?: number } = $props()
  let open = $state(false)
  let trigger = $state<HTMLButtonElement>()
  let panel = $state<HTMLDivElement>()
  let place = $state({ left: 0, top: 0 })
  let genres = $state<string[] | null>(null)
  // Plain latch, not $state: the catalog whose genres were last requested.
  let requested = ''

  function ensureGenres() {
    const target = get(catalogScreen)
    if (requested === target) return
    requested = target
    genres = null
    loadGenres(target)
      .then((list) => { if (requested === target) genres = list })
      .catch(() => { if (requested === target) genres = [] })
  }
  // The adult genre only shows where 18+ titles are switched on (and the profile allows them).
  const shown = $derived((genres ?? []).filter((genre) => $showAdult || genre.toLowerCase() !== 'hentai'))

  // The panel is fixed and portalled to <body>; positions are divided by the UI-scale zoom the same
  // way the card popup's are (preview-pos.ts).
  function toggle() {
    if (open) { open = false; return }
    const box = trigger?.getBoundingClientRect()
    const zoom = rootZoom()
    if (box) place = { left: Math.max(8, Math.min(box.left / zoom, window.innerWidth / zoom - 840)), top: box.bottom / zoom }
    ensureGenres()
    open = true
  }
  // Any navigation closes the menu, including one of its own links.
  $effect(() => {
    void page.url.href
    open = false
  })
  function onPointerDown(event: PointerEvent) {
    if (!open) return
    const target = event.target as Node
    if (panel?.contains(target) || trigger?.contains(target)) return
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
        data-focusable={focusable ? '' : undefined} {tabindex} aria-haspopup="true" aria-expanded={open} onclick={toggle}
        class="group relative inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-accent hover:text-foreground {open ? 'text-foreground' : 'text-muted-foreground'}">
  <span data-part="nav.item.label">Categories</span>
  <ChevronDown size={16} class="transition-transform duration-150 {open ? 'rotate-180' : ''}" />
</button>

{#if open}
  <div use:portal bind:this={panel} data-slot="nav.categories" role="menu" aria-label="Categories"
       class="fixed z-50 flex max-h-[70vh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-b-lg border border-border bg-card text-card-foreground shadow-2xl"
       style={`left:${place.left}px;top:${place.top}px`}>
    <div class="flex w-56 shrink-0 flex-col py-2">
      <a data-part="nav.categories.link" data-focusable role="menuitem" href="/app/search?sort=POPULARITY_DESC" class="px-4 py-3 text-base hover:bg-accent">Browse all</a>
      <a data-part="nav.categories.link" data-focusable role="menuitem" href="/app/schedule" class="px-4 py-3 text-base hover:bg-accent">Release calendar</a>
    </div>
    <div class="min-w-0 border-l border-border py-2">
      <div data-part="nav.categories.heading" class="px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Genres</div>
      {#if genres === null}
        <div class="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
      {:else}
        <div class="grid grid-cols-3">
          {#each shown as genre (genre)}
            <a data-part="nav.categories.link" data-variant="genre" data-focusable role="menuitem" href={`/app/search?genre=${encodeURIComponent(genre)}`}
               class="w-52 px-4 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{genre}</a>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
