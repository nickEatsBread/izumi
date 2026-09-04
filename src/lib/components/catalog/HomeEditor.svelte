<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { catalogHomeRowOptions, mergedCatalogHomeRowOptions } from '$lib/catalog/registry'
  import { catalogHomeLayouts, resetCatalogHomeLayout, resolveCatalogHomeRows, type CatalogHomeTarget } from '$lib/catalog/home-layout'
  import { homeEditorInsertRequest, homeEditorOpen, insertHomeRow } from '$lib/catalog/home-editor'
  import type { CatalogHomeRowOption } from '$lib/catalog/types'
  import { tmdbCustomHomeRows } from '$lib/catalog/tmdb-custom-rows'
  import { catalogLabel, catalogProviders } from '$lib/settings/catalog'
  import Check from '@lucide/svelte/icons/check'
  import Layers3 from '@lucide/svelte/icons/layers-3'
  import Plus from '@lucide/svelte/icons/plus'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Search from '@lucide/svelte/icons/search'
  import X from '@lucide/svelte/icons/x'

  let { target }: { target: CatalogHomeTarget } = $props()

  let options = $state<CatalogHomeRowOption[]>([])
  let loading = $state(false)
  let error = $state('')
  let sectionSearch = $state('')
  let dialog = $state<HTMLDivElement>()
  const label = $derived(target === 'merged' ? 'Merged' : catalogLabel(target))
  const rows = $derived(resolveCatalogHomeRows(target, options, $catalogHomeLayouts))
  const available = $derived(rows.filter((row) => !row.enabled))
  const matchingAvailable = $derived.by(() => {
    const query = sectionSearch.trim().toLowerCase()
    return query ? available.filter((row) => `${row.title} ${row.description ?? ''} ${row.group ?? ''}`.toLowerCase().includes(query)) : available
  })
  const groups = $derived.by(() => {
    const result = new Map<string, typeof matchingAvailable>()
    for (const row of matchingAvailable) {
      const group = row.group ?? 'More sections'
      result.set(group, [...(result.get(group) ?? []), row])
    }
    return [...result].map(([name, items]) => ({ name, items }))
  })
  const request = $derived($homeEditorInsertRequest?.target === target ? $homeEditorInsertRequest : null)
  const beforeTitle = $derived(request?.beforeId ? rows.find((row) => row.id === request.beforeId)?.title : null)
  const customRowsKey = $derived(target === 'tmdb' || target === 'merged' ? JSON.stringify($tmdbCustomHomeRows) : '')

  $effect(() => {
    if (!$homeEditorOpen) return
    const selection = target
    const providers = $catalogProviders
    void customRowsKey
    const abort = new AbortController()
    loading = true
    error = ''
    const load = selection === 'merged'
      ? mergedCatalogHomeRowOptions(providers, abort.signal)
      : catalogHomeRowOptions(selection, abort.signal)
    void load.then((result) => {
      if (!abort.signal.aborted) options = result
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => {
      if (!abort.signal.aborted) loading = false
    })
    return () => abort.abort()
  })

  $effect(() => {
    if (!request) return
    void tick().then(() => dialog?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }))
  })

  $effect(() => {
    if (!request) sectionSearch = ''
  })

  $effect(() => {
    if (!request) return
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
    }
  })

  function closeEditor() {
    sectionSearch = ''
    homeEditorInsertRequest.set(null)
    homeEditorOpen.set(false)
  }

  function add(rowId: string) {
    insertHomeRow(target, rows, rowId, request?.beforeId ?? null)
    homeEditorInsertRequest.set(null)
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    if (request) homeEditorInsertRequest.set(null)
    else closeEditor()
  }

  onDestroy(closeEditor)
</script>

<svelte:window onkeydown={onKeydown} />

{#if $homeEditorOpen}
  <div class="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-1/2 z-[65] flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-neutral-950/95 p-1.5 text-white shadow-2xl backdrop-blur-xl sm:bottom-6" transition:fly={{ y: 16, duration: 160 }}>
    <span class="hidden items-center gap-2 whitespace-nowrap px-2 text-sm font-black sm:flex">
      {#if target === 'merged'}<Layers3 size={17} class="text-cyan-300" />{/if}
      Editing {label}
    </span>
    <button type="button" data-focusable onclick={() => homeEditorInsertRequest.set({ target, beforeId: null })} class="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition hover:bg-white/10">
      <Plus size={17} /> <span class="hidden sm:inline">Add section</span><span class="sm:hidden">Add</span>
    </button>
    <button type="button" data-focusable aria-label={`Reset ${label} Home layout`} title="Reset layout" onclick={() => resetCatalogHomeLayout(target)} class="grid size-10 place-items-center rounded-xl text-white/65 transition hover:bg-white/10 hover:text-white">
      <RotateCcw size={17} />
    </button>
    <button type="button" data-focusable onclick={closeEditor} class="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-black text-black transition hover:bg-white/85">
      <Check size={17} /> Done
    </button>
  </div>

  {#if request}
    <button type="button" tabindex="-1" aria-label="Close section picker" onclick={() => homeEditorInsertRequest.set(null)} class="fixed inset-0 z-[74] bg-black/70 backdrop-blur-sm" transition:fade={{ duration: 120 }}></button>
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[75] flex max-h-[min(78vh,42rem)] justify-center sm:inset-0 sm:items-center sm:p-5">
      <div bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby="add-home-section-title" data-nav-trap class="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:max-w-xl sm:rounded-3xl" transition:fly={{ y: 22, duration: 170 }}>
        <div class="flex items-start gap-3 border-b border-border px-5 pb-4 pt-5">
          <div class="min-w-0 flex-1">
            <h2 id="add-home-section-title" class="text-lg font-black">Add a section</h2>
            <p class="mt-0.5 text-sm text-muted-foreground">{beforeTitle ? `It will appear above ${beforeTitle}.` : 'It will appear at the bottom of your Home.'}</p>
          </div>
          <button type="button" data-focusable aria-label="Close" onclick={() => homeEditorInsertRequest.set(null)} class="grid size-10 shrink-0 place-items-center rounded-full hover:bg-secondary"><X size={19} /></button>
        </div>

        {#if !loading && !error && available.length > 8}
          <label class="relative mx-4 mt-3 block">
            <span class="sr-only">Filter available sections</span>
            <Search size={17} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input bind:value={sectionSearch} type="search" placeholder="Find a genre, year, or catalog…"
              class="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-sm outline-none transition focus:border-theme/70" />
          </label>
        {/if}

        <div class="overflow-y-auto overscroll-contain p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
          {#if loading}
            <div class="space-y-2" aria-label="Loading available Home sections">{#each Array.from({ length: 5 }) as _}<div class="h-16 rounded-xl skeloader"></div>{/each}</div>
          {:else if error}
            <div role="alert" class="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm"><p class="font-black">Couldn’t load the section library</p><p class="mt-1 text-muted-foreground">{error}</p></div>
          {:else if groups.length}
            <div class="space-y-5">
              {#each groups as group (group.name)}
                <section>
                  <h3 class="mb-1.5 px-2 text-xs font-black uppercase tracking-wide text-muted-foreground">{group.name}</h3>
                  <div class="space-y-1">
                    {#each group.items as row (row.id)}
                      <button type="button" data-focusable onclick={() => add(row.id)} class="flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-secondary focus:bg-secondary">
                        <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-theme/15 text-theme"><Plus size={18} /></span>
                        <span class="min-w-0 flex-1"><span class="block font-black">{row.title}</span>{#if row.description}<span class="mt-0.5 block text-xs text-muted-foreground">{row.description}</span>{/if}</span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {:else if available.length && sectionSearch.trim()}
            <div class="rounded-2xl border border-dashed border-border p-8 text-center"><Search class="mx-auto text-muted-foreground" size={26} /><p class="mt-3 font-black">No matching sections</p><p class="mt-1 text-sm text-muted-foreground">Try a catalog name, genre, or year.</p></div>
          {:else}
            <div class="rounded-2xl border border-dashed border-border p-8 text-center"><Check class="mx-auto text-theme" size={26} /><p class="mt-3 font-black">Everything is already on your Home</p><p class="mt-1 text-sm text-muted-foreground">Hide a section first if you want to place it somewhere else.</p></div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/if}
