<script lang="ts">
  import LibraryNav from '$lib/components/library/LibraryNav.svelte'
  import { onDestroy, onMount } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Upload from '@lucide/svelte/icons/upload'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import {
    letterboxdFeedCache,
    letterboxdFeedUpdatedAt,
    letterboxdImportedAt,
    letterboxdImportedRecords,
    letterboxdMediaCache,
    letterboxdUsername,
  } from '$lib/letterboxd/config'
  import { fetchLetterboxdFeed, validLetterboxdUsername } from '$lib/letterboxd/feed'
  import {
    importedLetterboxdItems,
    readLetterboxdImport,
    resolveLetterboxdRecords,
  } from '$lib/letterboxd/import'
  import type {
    LetterboxdFeedEntry,
    LetterboxdImportCategory,
    LetterboxdResolvedItem,
  } from '$lib/letterboxd/types'

  let usernameInput = $state($letterboxdUsername)
  let feedLoading = $state(false)
  let feedError = $state('')
  let importing = $state(false)
  let importError = $state('')
  let importSummary = $state('')
  let resolving = $state(false)
  let resolveProgress = $state({ completed: 0, total: 0 })
  let picker: HTMLInputElement
  let controller: AbortController | null = null

  const feed = $derived($letterboxdFeedCache)
  const importedCount = $derived($letterboxdImportedRecords.length)
  const resolvedCount = $derived($letterboxdImportedRecords.filter((record) => Boolean($letterboxdMediaCache[record.key])).length)

  onMount(() => { if ($letterboxdUsername) void refreshFeed() })
  onDestroy(() => controller?.abort())

  function saveUsername() {
    const value = usernameInput.trim()
    if (!validLetterboxdUsername(value)) {
      feedError = 'Use 2–15 letters, numbers, or underscores.'
      return
    }
    if ($letterboxdUsername !== value) {
      $letterboxdFeedCache = []
      $letterboxdFeedUpdatedAt = 0
    }
    $letterboxdUsername = value
    void refreshFeed()
  }

  async function refreshFeed() {
    if (!$letterboxdUsername || feedLoading) return
    controller?.abort()
    controller = new AbortController()
    feedLoading = true
    feedError = ''
    try {
      await fetchLetterboxdFeed($letterboxdUsername, controller.signal)
    } catch (cause) {
      if ((cause as { name?: string })?.name !== 'AbortError') feedError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      feedLoading = false
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    importing = true
    importError = ''
    importSummary = ''
    try {
      const result = await readLetterboxdImport(file)
      importSummary = `${result.records.length.toLocaleString()} films imported from ${result.files.length} CSV file${result.files.length === 1 ? '' : 's'}.`
      await resolveMore(result.records)
    } catch (cause) {
      importError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      importing = false
    }
  }

  function prioritized(records = $letterboxdImportedRecords) {
    const weight = (record: (typeof records)[number]) => record.categories.includes('watchlist') ? 0
      : record.categories.includes('diary') ? 1
      : record.categories.includes('ratings') ? 2 : 3
    return [...records].sort((left, right) => weight(left) - weight(right))
  }

  async function resolveMore(records = $letterboxdImportedRecords) {
    if (resolving) return
    const unresolved = prioritized(records).filter((record) => !$letterboxdMediaCache[record.key])
    if (!unresolved.length) return
    resolving = true
    importError = ''
    resolveProgress = { completed: 0, total: Math.min(60, unresolved.length) }
    try {
      const resolved = await resolveLetterboxdRecords(unresolved, 60, (completed, total) => {
        resolveProgress = { completed, total }
      })
      if (!resolved.length) throw new Error('No imported films could be matched through TMDB. Add a TMDB read token in Catalog settings, then try again.')
    } catch (cause) {
      importError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      resolving = false
    }
  }

  function imported(category: LetterboxdImportCategory): LetterboxdResolvedItem[] {
    return importedLetterboxdItems($letterboxdImportedRecords, $letterboxdMediaCache, category)
  }

  function ratingLabel(rating?: number): string {
    if (!rating) return ''
    const whole = Math.floor(rating)
    return `${'★'.repeat(whole)}${rating - whole >= 0.5 ? '½' : ''}`
  }

  function feedSubline(entry: LetterboxdFeedEntry): string {
    return [ratingLabel(entry.rating), entry.rewatch ? 'Rewatch' : '', entry.watchedDate].filter(Boolean).join(' · ')
  }

  function importSubline(item: LetterboxdResolvedItem): string {
    return [ratingLabel(item.record.rating), item.record.rewatch ? 'Rewatch' : '', item.record.watchedDate ?? item.record.addedDate].filter(Boolean).join(' · ')
  }

  function updatedLabel(timestamp: number): string {
    return timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) : 'Never'
  }
</script>

<LibraryNav />

<svelte:head><title>Letterboxd · izumi</title></svelte:head>

{#snippet loadingRow(title: string)}
  <Carousel {title} attribution="Letterboxd RSS">
    {#each Array(7) as _, index (index)}<div class="skeloader h-[238px] w-36 shrink-0 rounded-xl sm:w-[152px]"></div>{/each}
  </Carousel>
{/snippet}

{#snippet openButton(uri?: string)}
  {#if uri}
    <button type="button" data-focusable onclick={() => openUrl(uri)} aria-label="Open on Letterboxd" title="Open on Letterboxd" class="absolute right-1.5 top-1.5 z-10 grid size-8 place-items-center rounded-full border border-white/15 bg-black/75 text-white opacity-100 backdrop-blur hover:bg-black sm:opacity-0 sm:group-hover/letterboxd:opacity-100 sm:focus:opacity-100"><ExternalLink size={15} /></button>
  {/if}
{/snippet}

{#snippet feedRow()}
  <Carousel title="Recent diary" attribution="Letterboxd RSS">
    {#each feed as entry (entry.key)}
      <div class="group/letterboxd relative shrink-0">
        <SmallCard media={entry.media} subline={feedSubline(entry)} simpleHover />
        {@render openButton(entry.uri)}
      </div>
    {/each}
  </Carousel>
{/snippet}

{#snippet importedRow(title: string, category: LetterboxdImportCategory)}
  {@const items = imported(category)}
  {#if items.length}
    <Carousel {title} attribution="Letterboxd export">
      {#each items as item (item.record.key)}
        <div class="group/letterboxd relative shrink-0">
          <SmallCard media={item.media} subline={importSubline(item)} simpleHover />
          {@render openButton(item.record.uri)}
        </div>
      {/each}
    </Carousel>
  {/if}
{/snippet}

<div class="min-h-full pb-24">
  <header class="relative overflow-hidden border-b border-border px-4 pb-8 pt-12 sm:px-8 sm:pb-10 sm:pt-16">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(0,224,84,0.16),transparent_34%),radial-gradient(circle_at_40%_0%,rgba(64,188,244,0.1),transparent_30%),radial-gradient(circle_at_65%_0%,rgba(255,128,0,0.1),transparent_30%)]"></div>
    <div class="relative max-w-5xl">
      <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div class="mb-3 flex gap-1" aria-hidden="true"><i class="size-3 rounded-full bg-[#00e054]"></i><i class="size-3 rounded-full bg-[#40bcf4]"></i><i class="size-3 rounded-full bg-[#ff8000]"></i></div>
          <h1 class="text-3xl font-black tracking-[-0.04em]">{$letterboxdUsername ? `${$letterboxdUsername} on Letterboxd` : 'Your films, from Letterboxd'}</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Official public RSS for what’s new; official export ZIP/CSV for the library behind it. Film identity stays on TMDB, the same source Letterboxd uses.</p>
        </div>
        {#if $letterboxdUsername}
          <div class="flex gap-2">
            <button type="button" data-focusable onclick={() => openUrl(`https://letterboxd.com/${encodeURIComponent($letterboxdUsername)}/`)} class="min-h-10 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">Open profile</button>
            <button type="button" data-focusable onclick={refreshFeed} disabled={feedLoading} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#00b746] px-4 text-sm font-bold text-white hover:bg-[#00c94d] disabled:opacity-50"><RefreshCw size={16} class={feedLoading ? 'animate-spin' : ''} />Refresh diary</button>
          </div>
        {/if}
      </div>

      {#if !$letterboxdUsername}
        <div class="mt-6 flex max-w-lg flex-col gap-2 sm:flex-row">
          <label for="hub-letterboxd-username" class="sr-only">Letterboxd username</label>
          <input id="hub-letterboxd-username" bind:value={usernameInput} autocomplete="username" data-focusable placeholder="Letterboxd username" class="h-11 min-w-0 flex-1 rounded-lg bg-input px-3 text-base sm:text-sm" onkeydown={(event) => event.key === 'Enter' && saveUsername()} />
          <button type="button" data-focusable onclick={saveUsername} class="min-h-11 rounded-lg bg-[#00b746] px-4 text-sm font-bold text-white">Load public diary</button>
        </div>
      {/if}
    </div>
  </header>

  {#if feedError}
    <p role="alert" class="mx-4 mt-5 max-w-2xl rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive sm:mx-8">{feedError}{feed.length ? ' Showing the last saved feed.' : ''}</p>
  {/if}

  <section class="mx-4 my-8 max-w-5xl rounded-2xl border border-border bg-card/35 p-5 sm:mx-8 sm:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">Full library</p>
        <h2 class="mt-1 text-lg font-black">Import the Letterboxd export</h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">Choose the ZIP downloaded from Letterboxd, or one extracted CSV. Izumi recognizes Diary, Watched, Ratings, Watchlist, and Lists without uploading the file anywhere.</p>
      </div>
      <div class="flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" data-focusable onclick={() => openUrl('https://letterboxd.com/user/exportdata/')} class="min-h-10 rounded-lg bg-secondary px-4 text-sm font-bold hover:bg-accent">Get export</button>
        <button type="button" data-focusable onclick={() => picker.click()} disabled={importing} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-bold text-background disabled:opacity-50"><Upload size={16} />{importing ? 'Importing…' : 'Choose ZIP or CSV'}</button>
        <input bind:this={picker} type="file" accept=".zip,.csv,text/csv,application/zip" class="hidden" onchange={importFile} />
      </div>
    </div>
    {#if importedCount}
      <div class="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p><strong>{importedCount.toLocaleString()}</strong> films imported · <strong>{resolvedCount.toLocaleString()}</strong> matched to TMDB <span class="text-muted-foreground">· imported {updatedLabel($letterboxdImportedAt)}</span></p>
        {#if resolvedCount < importedCount}
          <button type="button" data-focusable onclick={() => resolveMore()} disabled={resolving} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent disabled:opacity-50">{resolving ? `Matching ${resolveProgress.completed}/${resolveProgress.total}…` : 'Match next 60'}</button>
        {/if}
      </div>
    {/if}
    {#if importSummary}<p aria-live="polite" class="mt-3 text-sm text-emerald-400">{importSummary}</p>{/if}
    {#if importError}<p role="alert" class="mt-3 text-sm text-destructive">{importError}</p>{/if}
  </section>

  {#if feedLoading && !feed.length}
    {@render loadingRow('Recent diary')}
  {:else if feed.length}
    {@render feedRow()}
  {:else if $letterboxdUsername}
    <div class="mx-4 mb-8 rounded-xl border border-border bg-card/30 px-4 py-6 text-sm text-muted-foreground sm:mx-8">No film diary entries were found in the current RSS window.</div>
  {/if}

  {@render importedRow('Imported Watchlist', 'watchlist')}
  {@render importedRow('Imported diary', 'diary')}
  {@render importedRow('Your ratings', 'ratings')}
  {@render importedRow('Watched films', 'watched')}

  {#if $letterboxdFeedUpdatedAt && feed.length}
    <p class="px-4 text-[11px] text-muted-foreground sm:px-8">Public diary updated {updatedLabel($letterboxdFeedUpdatedAt)}.</p>
  {/if}
</div>
