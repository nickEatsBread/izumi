<script lang="ts">
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import { onDestroy, onMount } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import BookmarkMinus from '@lucide/svelte/icons/bookmark-minus'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import {
    traktToken,
    traktUserAvatar,
    traktUserName,
    traktUserSlug,
  } from '$lib/trakt/config'
  import {
    hideTraktRecommendation,
    loadTraktHub,
    type TraktHubData,
    type TraktHubItem,
    type TraktHubSection,
  } from '$lib/trakt/catalog'
  import { setTraktWatchlist } from '$lib/trakt/sync'

  let data = $state<TraktHubData | null>(null)
  let loading = $state(false)
  let error = $state('')
  let actionError = $state('')
  let pending = $state(new Set<string>())
  let controller: AbortController | null = null

  onMount(() => { if ($traktToken) void refresh() })
  onDestroy(() => controller?.abort())

  async function refresh() {
    controller?.abort()
    controller = new AbortController()
    loading = true
    error = ''
    actionError = ''
    try {
      data = await loadTraktHub(controller.signal)
    } catch (cause) {
      if ((cause as { name?: string })?.name !== 'AbortError') error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  const key = (item: TraktHubItem) => `${item.kind}:${item.traktId}`

  async function hideRecommendation(item: TraktHubItem, section: 'movieRecommendations' | 'showRecommendations') {
    const id = key(item)
    pending = new Set(pending).add(id)
    actionError = ''
    try {
      await hideTraktRecommendation(item)
      if (data) data = { ...data, [section]: data[section].filter((row) => key(row) !== id) }
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      pending = new Set([...pending].filter((value) => value !== id))
    }
  }

  async function removeWatchlist(item: TraktHubItem) {
    const id = key(item)
    pending = new Set(pending).add(id)
    actionError = ''
    try {
      const removed = await setTraktWatchlist(item.media, false)
      if (!removed) throw new Error('The Watchlist change is queued and will retry when Trakt is reachable.')
      if (data) data = { ...data, watchlist: data.watchlist.filter((row) => key(row) !== id) }
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      pending = new Set([...pending].filter((value) => value !== id))
    }
  }

  function sectionError(section: TraktHubSection): string {
    return data?.errors[section] ?? ''
  }
</script>

<LibraryNav />

<svelte:head><title>Trakt · izumi</title></svelte:head>

{#snippet skeletonRow(title: string)}
  <Carousel {title} attribution="Trakt">
    {#each Array(7) as _, index (index)}
      <div class="skeloader h-[238px] w-36 shrink-0 rounded-xl sm:w-[152px]"></div>
    {/each}
  </Carousel>
{/snippet}

{#snippet emptyRow(message: string)}
  <div class="mx-4 mb-8 rounded-xl border border-border bg-card/30 px-4 py-6 text-sm text-muted-foreground sm:mx-8">{message}</div>
{/snippet}

{#snippet mediaRow(title: string, section: TraktHubSection, items: TraktHubItem[], action: 'hide' | 'remove' | 'none')}
  {#if items.length}
    <Carousel {title} attribution="Trakt">
      {#each items as item (key(item))}
        <div class="group/trakt relative shrink-0">
          <SmallCard media={item.media} subline={item.context} simpleHover />
          {#if action !== 'none'}
            <button
              type="button"
              data-focusable
              disabled={pending.has(key(item))}
              aria-label={action === 'hide' ? `Hide ${item.media.title.userPreferred} recommendation` : `Remove ${item.media.title.userPreferred} from Trakt Watchlist`}
              title={action === 'hide' ? 'Hide recommendation' : 'Remove from Watchlist'}
              onclick={() => action === 'hide'
                ? hideRecommendation(item, section as 'movieRecommendations' | 'showRecommendations')
                : removeWatchlist(item)}
              class="absolute right-1.5 top-1.5 z-10 grid size-8 place-items-center rounded-full border border-white/15 bg-black/75 text-white opacity-100 backdrop-blur transition hover:bg-black disabled:opacity-40 sm:opacity-0 sm:group-hover/trakt:opacity-100 sm:focus:opacity-100"
            >
              {#if action === 'hide'}<EyeOff size={15} />{:else}<BookmarkMinus size={15} />{/if}
            </button>
          {/if}
        </div>
      {/each}
    </Carousel>
  {:else if sectionError(section)}
    {@render emptyRow(sectionError(section))}
  {:else}
    {@render emptyRow(section === 'history' ? 'No recent Trakt history yet.' : section === 'watchlist' ? 'Your Trakt Watchlist is empty.' : 'Trakt has no recommendations in this category yet.')}
  {/if}
{/snippet}

<div class="min-h-full pb-24">
  <header class="relative overflow-hidden border-b border-border px-4 pb-8 pt-12 sm:px-8 sm:pb-10 sm:pt-16">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(237,28,36,0.2),transparent_42%)]"></div>
    <div class="relative flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex items-center gap-4">
        {#if $traktUserAvatar}
          <img src={$traktUserAvatar} alt="" class="size-14 rounded-2xl object-cover ring-1 ring-white/15" />
        {:else}
          <span class="grid size-14 place-items-center rounded-2xl bg-[#ed1c24] text-xs font-black text-white">TRAKT</span>
        {/if}
        <div>
          <p class="text-[11px] font-black uppercase tracking-[0.2em] text-[#ff5b60]">Native account</p>
          <h1 class="mt-1 text-3xl font-black tracking-[-0.04em]">{$traktUserName || 'Your Trakt'}</h1>
          <p class="mt-1 text-sm text-muted-foreground">Personal recommendations, Watchlist, and the stories you watched recently.</p>
        </div>
      </div>
      <div class="flex gap-2">
        {#if $traktUserSlug}
          <button type="button" data-focusable onclick={() => openUrl(`https://trakt.tv/users/${encodeURIComponent($traktUserSlug)}`)} class="min-h-10 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">Open profile</button>
        {/if}
        {#if $traktToken}
          <button type="button" data-focusable onclick={refresh} disabled={loading} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#ed1c24] px-4 text-sm font-bold text-white hover:bg-[#ff3038] disabled:opacity-50"><RefreshCw size={16} class={loading ? 'animate-spin' : ''} /> Refresh</button>
        {/if}
      </div>
    </div>
  </header>

  {#if !$traktToken}
    <div class="mx-4 mt-8 max-w-2xl rounded-2xl border border-border bg-card/40 p-6 sm:mx-8">
      <h2 class="text-lg font-black">Connect Trakt first</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">Link a Trakt application to bring recommendations, Watchlist, history, ratings, and automatic playback sync into Izumi.</p>
      <a href="/app/settings/accounts" data-focusable class="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#ed1c24] px-4 text-sm font-bold text-white">Open Accounts</a>
    </div>
  {:else if loading && !data}
    <div class="pt-8">
      {@render skeletonRow('Movies for you')}
      {@render skeletonRow('Shows for you')}
      {@render skeletonRow('Watchlist')}
    </div>
  {:else if error}
    <div role="alert" class="mx-4 mt-8 max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/10 p-5 sm:mx-8">
      <p class="font-bold">Trakt could not load</p>
      <p class="mt-1 text-sm text-muted-foreground">{error}</p>
      <button type="button" data-focusable onclick={refresh} class="mt-4 min-h-10 rounded-lg bg-secondary px-4 text-sm font-bold">Try again</button>
    </div>
  {:else if data}
    <div class="pt-8" aria-busy={loading}>
      {#if actionError}<p role="alert" class="mx-4 mb-5 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive sm:mx-8">{actionError}</p>{/if}
      {@render mediaRow('Movies for you', 'movieRecommendations', data.movieRecommendations, 'hide')}
      {@render mediaRow('Shows for you', 'showRecommendations', data.showRecommendations, 'hide')}
      {@render mediaRow('Watchlist', 'watchlist', data.watchlist, 'remove')}
      {@render mediaRow('Recently watched', 'history', data.history, 'none')}
    </div>
  {/if}
</div>
