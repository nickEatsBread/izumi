<script lang="ts">
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import { cover, format, mediaHref, status, title } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { mediaKey } from '$lib/catalog/identity'
  import { enabledCatalogProviders } from '$lib/settings/catalog'
  import { createSearchRequestGuard, normalizeSearchQuery } from '$lib/search/global-search'
  import { cachedQuickSearch, quickSearch } from '$lib/search/quick-search'
  import { portal } from '$lib/util/portal'
  import { rootZoom } from '$lib/components/cards/preview-pos'

  // The theme top bar's inline search. Typing shows live results under the field, the way a
  // site's header search does (`search.suggestions`); Enter opens the highlighted result, or the
  // search page with the query.
  let { className = '', focusable = true, tabindex = undefined }: { className?: string; focusable?: boolean; tabindex?: number } = $props()
  let query = $state('')
  let results = $state<Media[]>([])
  let focused = $state(false)
  let active = $state(-1)
  const LIMIT = 6
  const guard = createSearchRequestGuard()
  const clean = $derived(normalizeSearchQuery(query))
  const open = $derived(focused && !!clean && results.length > 0)

  // The panel is portalled to <body> and fixed under the field: the top bar clips its overflow.
  // Positions are divided by the UI-scale zoom like the Categories menu's (preview-pos.ts).
  let form = $state<HTMLFormElement>()
  let place = $state({ left: 0, top: 0, width: 0 })
  $effect(() => {
    const node = form
    if (!open || !node) return
    const measure = () => {
      const box = node.getBoundingClientRect()
      const zoom = rootZoom()
      place = { left: box.left / zoom, top: box.bottom / zoom, width: box.width / zoom }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  })

  $effect(() => {
    const text = clean
    const selections = $enabledCatalogProviders
    const request = guard.begin()
    active = -1
    if (!text) { results = []; return }
    const cached = cachedQuickSearch(text, selections)
    if (cached) { results = cached.slice(0, LIMIT); return }
    const timer = setTimeout(async () => {
      if (!guard.isCurrent(request)) return
      try {
        const media = await quickSearch(text, selections)
        if (guard.isCurrent(request)) results = media.slice(0, LIMIT)
      } catch {
        if (guard.isCurrent(request)) results = []
      }
    }, 180)
    return () => clearTimeout(timer)
  })

  const meta = (media: Media) => [
    format(media),
    media.episodes ? `${media.episodes} Eps` : '',
    media.seasonYear ?? media.startDate?.year ?? '',
    status(media),
  ].filter(Boolean).join(' • ')

  function searchPage() {
    const text = query.trim()
    focused = false
    void goto(text ? `/app/search?search=${encodeURIComponent(text)}` : '/app/search')
  }
  function choose(media: Media) {
    focused = false
    query = ''
    void goto(mediaHref(media))
  }
  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (open && results[active]) choose(results[active])
    else searchPage()
  }
  function keys(event: KeyboardEvent) {
    if (!open) return
    if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % results.length }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = active <= 0 ? results.length - 1 : active - 1 }
    else if (event.key === 'Escape') { event.preventDefault(); focused = false }
  }
</script>

<form bind:this={form} role="search" onsubmit={submit} class="relative {className}">
  <Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
  <input data-part="search.field" data-focusable={focusable ? '' : undefined} {tabindex} type="search" bind:value={query} placeholder="Search anime…" aria-label="Search"
    role="combobox" aria-autocomplete="list" aria-controls="top-search-suggestions" aria-expanded={open}
    onfocus={() => (focused = true)} onblur={() => (focused = false)} onkeydown={keys}
    class="h-9 w-full rounded-lg border border-border bg-secondary/60 pl-9 pr-3 text-sm outline-none transition focus:border-theme/70 focus:bg-background" />
  {#if open}
    <!-- Pointer-down keeps the focus in the field, so a click reaches the row before blur closes the panel. -->
    <div use:portal id="top-search-suggestions" data-part="search.suggestions" role="listbox" tabindex="-1" onpointerdown={(event) => event.preventDefault()}
         style={`left:${place.left}px;top:${place.top}px;width:${place.width}px`}
         class="fixed z-50 mt-2 overflow-hidden rounded-lg border border-border bg-card p-1 text-card-foreground shadow-xl">
      {#each results as media, index (mediaKey(media))}
        <a data-part="search.suggestion" data-active={index === active || undefined} href={mediaHref(media)} role="option" aria-selected={index === active}
           onclick={(event) => { event.preventDefault(); choose(media) }}
           class="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-accent {index === active ? 'bg-accent' : ''}">
          {#if cover(media)}<img data-part="search.suggestion.poster" src={cover(media)} alt="" loading="lazy" class="h-14 w-10 shrink-0 rounded object-cover" />{/if}
          <div class="min-w-0">
            <p data-part="search.suggestion.title" class="line-clamp-1 text-sm font-semibold">{title(media)}</p>
            <p data-part="search.suggestion.meta" class="line-clamp-1 text-xs text-muted-foreground">{meta(media)}</p>
          </div>
        </a>
      {/each}
      <a data-part="search.suggestion.all" href={`/app/search?search=${encodeURIComponent(query.trim())}`} onclick={(event) => { event.preventDefault(); searchPage() }}
         class="block rounded-md px-2 py-2 text-center text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">View all results</a>
    </div>
  {/if}
</form>
