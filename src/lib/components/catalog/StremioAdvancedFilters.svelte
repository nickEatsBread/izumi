<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import MultiSelect from '$lib/components/search/MultiSelect.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { advancedFiltersOpen } from '$lib/player/session'
  import type { CatalogAdvancedSearchFilters, CatalogSearchOptions } from '$lib/catalog/types'

  let {
    filters,
    options,
    genres = [],
    onApply,
    onClose,
  }: {
    filters: CatalogAdvancedSearchFilters
    options: CatalogSearchOptions
    genres?: string[]
    onApply: (filters: CatalogAdvancedSearchFilters) => void
    onClose: () => void
  } = $props()

  let draft = $state<CatalogAdvancedSearchFilters>(
    untrack(() => $state.snapshot(filters)) as CatalogAdvancedSearchFilters,
  )

  const sourceOptions = $derived([
    { value: '', label: 'All enabled add-ons' },
    ...(options.sources ?? []),
  ])
  const set = (patch: Partial<CatalogAdvancedSearchFilters>) => (draft = { ...draft, ...patch })
  const numberValue = (value: string, maximum?: number): number | undefined => {
    if (value === '') return undefined
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return undefined
    return Math.max(0, maximum == null ? parsed : Math.min(maximum, parsed))
  }

  function clearAll() {
    draft = {
      ...draft,
      minScore: undefined,
      maxScore: undefined,
      language: undefined,
      country: undefined,
      releaseDateFrom: undefined,
      releaseDateTo: undefined,
      runtimeMin: undefined,
      runtimeMax: undefined,
      excludedGenres: undefined,
      withPoster: undefined,
      sourceAddonId: undefined,
    }
  }

  function apply() {
    const next = $state.snapshot(draft) as CatalogAdvancedSearchFilters
    if (next.minScore != null && next.maxScore != null && next.minScore > next.maxScore) {
      ;[next.minScore, next.maxScore] = [next.maxScore, next.minScore]
    }
    if (next.runtimeMin != null && next.runtimeMax != null && next.runtimeMin > next.runtimeMax) {
      ;[next.runtimeMin, next.runtimeMax] = [next.runtimeMax, next.runtimeMin]
    }
    if (next.releaseDateFrom && next.releaseDateTo && next.releaseDateFrom > next.releaseDateTo) {
      ;[next.releaseDateFrom, next.releaseDateTo] = [next.releaseDateTo, next.releaseDateFrom]
    }
    onApply(next)
  }

  onMount(() => {
    advancedFiltersOpen.set(true)
    const close = () => onClose()
    window.addEventListener('advanced-close', close)
    return () => {
      advancedFiltersOpen.set(false)
      window.removeEventListener('advanced-close', close)
    }
  })
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Stremio filters"
  tabindex="-1"
  data-nav-trap
  class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onClose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onClose() }}
>
  <div class="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl sm:max-h-[88vh]">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div>
        <h2 class="text-lg font-black">Stremio filters</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">Filters use the metadata supplied by each add-on.</p>
      </div>
      <button
        type="button"
        data-focusable
        onclick={onClose}
        aria-label="Close Stremio filters"
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.98]"
      >
        <X size={18} />
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
      {#if sourceOptions.length > 1}
        <section class="grid gap-2">
          <h3 class="text-sm font-black">Metadata add-on</h3>
          <SelectMenu
            value={draft.sourceAddonId ?? ''}
            ariaLabel="Metadata add-on"
            className="w-full"
            options={sourceOptions}
            onChange={(value) => set({ sourceAddonId: value || undefined })}
          />
          <p class="text-xs text-muted-foreground">Limit the search to one configured catalog source.</p>
        </section>
      {/if}

      <div class="grid gap-4 sm:grid-cols-2">
        <section class="grid gap-3 rounded-lg border border-border/70 p-3">
          <h3 class="text-sm font-black">Rating range</h3>
          <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
              Minimum
              <input
                type="number"
                min="0"
                max="100"
                inputmode="numeric"
                data-focusable
                value={draft.minScore ?? ''}
                oninput={(event) => set({ minScore: numberValue(event.currentTarget.value, 100) })}
                class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <span class="pb-2 text-xs text-muted-foreground">to</span>
            <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
              Maximum
              <input
                type="number"
                min="0"
                max="100"
                inputmode="numeric"
                data-focusable
                value={draft.maxScore ?? ''}
                oninput={(event) => set({ maxScore: numberValue(event.currentTarget.value, 100) })}
                class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          </div>
          <p class="text-xs text-muted-foreground">Izumi’s 0 to 100 rating scale.</p>
        </section>

        <section class="grid gap-3 rounded-lg border border-border/70 p-3">
          <h3 class="text-sm font-black">Runtime</h3>
          <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
              Minimum minutes
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-focusable
                value={draft.runtimeMin ?? ''}
                oninput={(event) => set({ runtimeMin: numberValue(event.currentTarget.value) })}
                class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <span class="pb-2 text-xs text-muted-foreground">to</span>
            <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
              Maximum minutes
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-focusable
                value={draft.runtimeMax ?? ''}
                oninput={(event) => set({ runtimeMax: numberValue(event.currentTarget.value) })}
                class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          </div>
          <p class="text-xs text-muted-foreground">Episode length for series, total length for movies.</p>
        </section>
      </div>

      <section class="grid gap-3 rounded-lg border border-border/70 p-3">
        <h3 class="text-sm font-black">Release window</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Released from
            <input
              type="date"
              data-focusable
              value={draft.releaseDateFrom ?? ''}
              oninput={(event) => set({ releaseDateFrom: event.currentTarget.value || undefined })}
              class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label class="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Released by
            <input
              type="date"
              data-focusable
              value={draft.releaseDateTo ?? ''}
              oninput={(event) => set({ releaseDateTo: event.currentTarget.value || undefined })}
              class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        </div>
      </section>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="grid gap-2 rounded-lg border border-border/70 p-3 text-xs font-semibold text-muted-foreground">
          <span class="text-sm font-black text-foreground">Original language</span>
          <input
            type="text"
            data-focusable
            value={draft.language ?? ''}
            oninput={(event) => set({ language: event.currentTarget.value || undefined })}
            class="rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          />
          <span>For example: Japanese or English.</span>
        </label>
        <label class="grid gap-2 rounded-lg border border-border/70 p-3 text-xs font-semibold text-muted-foreground">
          <span class="text-sm font-black text-foreground">Country of origin</span>
          <input
            type="text"
            data-focusable
            value={draft.country ?? ''}
            oninput={(event) => set({ country: event.currentTarget.value || undefined })}
            class="rounded-md bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent"
          />
          <span>Matches full or partial country names.</span>
        </label>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <section class="grid gap-2 rounded-lg border border-border/70 p-3">
          <h3 class="text-sm font-black">Exclude genres</h3>
          {#if genres.length}
            <MultiSelect
              label="Choose genres"
              options={genres}
              selected={draft.excludedGenres ?? []}
              onchange={(value) => set({ excludedGenres: value.length ? value : undefined })}
            />
          {:else}
            <p class="text-xs text-muted-foreground">The enabled add-ons did not publish a genre list.</p>
          {/if}
        </section>

        <label class="flex min-h-20 items-center gap-3 rounded-lg border border-border/70 p-3 text-sm font-bold">
          <input
            type="checkbox"
            data-focusable
            checked={!!draft.withPoster}
            onchange={(event) => set({ withPoster: event.currentTarget.checked || undefined })}
            class="size-4 accent-theme"
          />
          <span>
            Require poster artwork
            <span class="mt-1 block text-xs font-normal text-muted-foreground">Hide incomplete catalog records.</span>
          </span>
        </label>
      </div>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <button
        type="button"
        data-focusable
        onclick={clearAll}
        class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.98]"
      >
        Clear all
      </button>
      <button
        type="button"
        data-focusable
        onclick={apply}
        class="rounded-md bg-primary px-5 py-2 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.98]"
      >
        Apply filters
      </button>
    </div>
  </div>
</div>
