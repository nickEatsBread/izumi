<script lang="ts">
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'
  import Clock from '@lucide/svelte/icons/clock-3'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import { anilist } from '$lib/anilist/client'
  import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
  import { cover, format, season, status, title } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import * as h from '$lib/haptics'
  import { portal } from '$lib/util/portal'
  import {
    RECENT_SEARCHES_KEY,
    addRecentSearch,
    advancedSearchHref,
    closeGlobalSearch,
    createSearchRequestGuard,
    globalSearchOpen,
    normalizeSearchQuery,
    plainTextSynopsis,
    rankQuickSearchResults,
  } from '$lib/search/global-search'
  import { incognito } from '$lib/stores/incognito'
  import { get } from 'svelte/store'

  type SearchState = 'idle' | 'typing' | 'loading' | 'done' | 'error'
  type SearchResponse = { Page?: { media?: Media[] } }

  const guard = createSearchRequestGuard()
  const cache = new Map<string, { expires: number; media: Media[] }>()
  const CACHE_MS = 2 * 60 * 1000

  let query = $state('')
  let results = $state<Media[]>([])
  let searchState = $state<SearchState>('idle')
  let error = $state('')
  let recent = $state<string[]>([])
  let input = $state<HTMLInputElement>()
  let returnFocus: HTMLElement | null = null
  let recentLoaded = false
  let wasOpen = false

  function loadRecent() {
    if (recentLoaded || typeof localStorage === 'undefined') return
    recentLoaded = true
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')
      if (Array.isArray(value)) recent = value.filter((item): item is string => typeof item === 'string').slice(0, 6)
    } catch {
      recent = []
    }
  }

  function remember(value = query) {
    if (get(incognito)) return // incognito searches never join the recent list
    const next = addRecentSearch(recent, value)
    if (next.join('\n') === recent.join('\n')) return
    recent = next
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)) } catch { /* storage may be unavailable */ }
  }

  async function close(record = false) {
    if (record) remember()
    guard.invalidate()
    closeGlobalSearch()
  }

  async function choose(media: Media) {
    h.tap()
    remember()
    await close()
    await goto(`/app/anime/${media.id}`)
  }

  async function advanced() {
    h.tap()
    remember()
    const href = advancedSearchHref(query)
    await close()
    await goto(href)
  }

  function useRecent(value: string) {
    h.tap()
    query = value
    tick().then(() => input?.focus({ preventScroll: true }))
  }

  function clearRecent() {
    h.tap()
    recent = []
    try { localStorage.removeItem(RECENT_SEARCHES_KEY) } catch { /* storage may be unavailable */ }
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && results[0]) {
      event.preventDefault()
      choose(results[0])
    }
  }

  $effect(() => {
    if (!$globalSearchOpen) {
      guard.invalidate()
      return
    }
    const clean = normalizeSearchQuery(query)
    const request = guard.begin()
    error = ''

    if (!clean) {
      results = []
      searchState = 'idle'
      return
    }

    const cached = cache.get(clean.toLocaleLowerCase())
    if (cached && cached.expires > Date.now()) {
      results = cached.media
      searchState = 'done'
      return
    }

    results = []
    searchState = 'typing'
    const timer = setTimeout(async () => {
      if (!guard.isCurrent(request)) return
      searchState = 'loading'
      const response = await anilist
        .query<SearchResponse>(searchQuery(), { ...searchVariables({ search: clean }), perPage: 10 }, { requestPolicy: 'network-only' })
        .toPromise()
      if (!guard.isCurrent(request)) return
      if (response.error) {
        searchState = 'error'
        error = response.error.message
        return
      }
      const media = rankQuickSearchResults(response.data?.Page?.media ?? [], clean)
      cache.set(clean.toLocaleLowerCase(), { expires: Date.now() + CACHE_MS, media })
      results = media
      searchState = 'done'
    }, 180)

    return () => clearTimeout(timer)
  })

  // Store-driven lifecycle so launchers elsewhere in the shell get the same focus/recent-search
  // behaviour as the keyboard shortcut, and controller B restores the original focus too.
  $effect(() => {
    if ($globalSearchOpen && !wasOpen) {
      wasOpen = true
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      loadRecent()
      tick().then(() => input?.focus({ preventScroll: true }))
    } else if (!$globalSearchOpen && wasOpen) {
      wasOpen = false
      const target = returnFocus
      returnFocus = null
      tick().then(() => {
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    }
  })

  $effect(() => {
    if (!$globalSearchOpen) return
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

{#if $globalSearchOpen}
  <div use:portal data-nav-trap class="fixed inset-0 z-[70] isolate flex items-start justify-center px-3 pt-[max(3.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[9vh]">
    <button type="button" class="absolute inset-0 bg-black/75 backdrop-blur-md" aria-label="Close search" onclick={() => close()}></button>
    <div role="dialog" aria-modal="true" aria-label="Search anime"
      class="relative z-10 flex max-h-[min(86vh,52rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl">
      <div class="flex items-center gap-3 border-b border-border px-4 transition-colors focus-within:border-theme/70 sm:px-5">
        <Search size={23} class="shrink-0 text-theme" />
        <input bind:this={input} bind:value={query} data-focusable type="search"
          placeholder="Search anime…" aria-label="Search anime" autocomplete="off" onkeydown={onInputKeydown}
          style="box-shadow:none"
          class="min-w-0 flex-1 bg-transparent py-4 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground sm:py-5 sm:text-xl" />
        {#if searchState === 'loading'}<LoaderCircle size={20} class="shrink-0 animate-spin text-muted-foreground" />{/if}
        <span class="hidden rounded-md border border-border bg-background/70 px-2 py-1 font-mono text-[0.65rem] font-bold text-muted-foreground sm:inline">Esc</span>
        <button type="button" data-focusable onclick={() => close()} aria-label="Close search"
          class="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X size={20} />
        </button>
      </div>

      <div class="min-h-0 overflow-y-auto p-3 sm:p-5">
        {#if !normalizeSearchQuery(query)}
          <div class="grid gap-5 sm:grid-cols-[1fr_auto]">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3 px-1">
                <h2 class="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-muted-foreground">
                  <Clock size={15} /> Recent searches
                </h2>
                {#if recent.length}
                  <button type="button" data-focusable onclick={clearRecent}
                    class="text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">Clear</button>
                {/if}
              </div>
              {#if recent.length}
                <div class="flex flex-wrap gap-2">
                  {#each recent as item (item)}
                    <button type="button" data-focusable onclick={() => useRecent(item)}
                      class="rounded-full border border-border bg-secondary/60 px-3 py-2 text-sm font-bold transition-colors hover:border-theme/50 hover:bg-secondary">
                      {item}
                    </button>
                  {/each}
                </div>
              {:else}
                <p class="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  Start typing to search AniList. Your recent searches will appear here.
                </p>
              {/if}
            </div>
            <button type="button" data-focusable onclick={advanced}
              class="flex min-w-48 items-center justify-between gap-4 self-start rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-theme/50 hover:bg-secondary">
              <span><span class="block text-sm font-black">Advanced search</span><span class="mt-0.5 block text-xs text-muted-foreground">Genres, seasons and filters</span></span>
              <SlidersHorizontal size={19} class="text-theme" />
            </button>
          </div>
        {:else if searchState === 'typing' || searchState === 'loading'}
          <div class="space-y-3" aria-label="Searching">
            {#each Array(5) as _}
              <div class="flex animate-pulse gap-3 rounded-xl bg-secondary/35 p-3">
                <div class="h-20 w-14 rounded-md bg-muted"></div>
                <div class="flex-1 space-y-3 py-2"><div class="h-4 w-1/2 rounded bg-muted"></div><div class="h-3 w-1/3 rounded bg-muted"></div></div>
              </div>
            {/each}
          </div>
        {:else if searchState === 'error'}
          <div class="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-8 text-center">
            <p class="font-black">Search failed</p>
            <p class="mt-1 text-sm text-muted-foreground">{error || 'Check your connection and try again.'}</p>
          </div>
        {:else if results.length}
          {@const best = results[0]}
          {@const synopsis = plainTextSynopsis(best.description)}
          <div class="space-y-5">
            <button type="button" data-focusable onclick={() => choose(best)}
              class="group relative flex min-h-44 w-full overflow-hidden rounded-2xl border border-border bg-secondary/45 text-left transition-colors hover:border-theme/60">
              {#if best.bannerImage}
                <img src={best.bannerImage} alt="" decoding="async" fetchpriority="high" class="absolute inset-0 h-full w-full object-cover opacity-20 transition-transform duration-500 group-hover:scale-105" />
              {/if}
              <div class="absolute inset-0 bg-gradient-to-r from-card via-card/90 to-card/45"></div>
              {#if cover(best)}
                <img src={cover(best)} alt="" decoding="async" fetchpriority="high" class="relative m-4 h-36 w-24 shrink-0 self-center rounded-lg object-cover shadow-xl sm:m-5 sm:h-40 sm:w-28" />
              {/if}
              <span class="relative flex min-w-0 flex-1 flex-col justify-center py-4 pr-5 sm:py-5 sm:pr-8">
                <span class="text-[0.65rem] font-black uppercase tracking-[0.2em] text-theme">Top match</span>
                <span class="mt-2 line-clamp-2 text-xl font-black sm:text-3xl">{title(best)}</span>
                <span class="mt-2 text-sm text-muted-foreground">
                  {[format(best), season(best), status(best), best.averageScore ? `${best.averageScore}%` : ''].filter(Boolean).join(' · ')}
                </span>
                {#if synopsis}
                  <span class="mt-3 hidden max-h-10 max-w-3xl overflow-hidden text-sm leading-5 text-muted-foreground sm:block"
                    style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2">{synopsis}</span>
                {/if}
                <span class="mt-4 inline-flex items-center gap-1 text-sm font-black text-theme">View details <ArrowRight size={16} /></span>
              </span>
            </button>

            {#if results.length > 1}
              <h2 class="px-1 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">More results</h2>
            {/if}
            <div class="grid gap-1 lg:grid-cols-2 lg:gap-x-4">
              {#each results.slice(1) as media (media.id)}
                <button type="button" data-focusable onclick={() => choose(media)}
                  class="group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-secondary">
                  {#if cover(media)}
                    <img src={cover(media)} alt="" loading="lazy" decoding="async" class="h-16 w-11 shrink-0 rounded-md object-cover" />
                  {:else}
                    <span class="h-16 w-11 shrink-0 rounded-md bg-muted"></span>
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-black group-hover:text-theme">{title(media)}</span>
                    <span class="mt-1 block truncate text-xs text-muted-foreground">{[format(media), season(media)].filter(Boolean).join(' · ') || status(media)}</span>
                  </span>
                  <ArrowRight size={17} class="shrink-0 text-muted-foreground" />
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p class="font-black">No anime found for “{normalizeSearchQuery(query)}”</p>
            <p class="mt-1 text-sm text-muted-foreground">Try another title or use advanced filters.</p>
          </div>
        {/if}
      </div>

      {#if normalizeSearchQuery(query)}
        <div class="border-t border-border bg-background/35 p-3">
          <button type="button" data-focusable onclick={advanced}
            class="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <SlidersHorizontal size={17} /> Search “{normalizeSearchQuery(query)}” with advanced filters
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
