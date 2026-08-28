<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { advancedFiltersOpen } from '$lib/player/session'
  import type { CatalogAdvancedSearchFilters, CatalogSearchOptions } from '$lib/catalog/types'

  let {
    filters,
    options,
    queryActive = false,
    onApply,
    onClose,
  }: {
    filters: CatalogAdvancedSearchFilters
    options: CatalogSearchOptions
    queryActive?: boolean
    onApply: (filters: CatalogAdvancedSearchFilters) => void
    onClose: () => void
  } = $props()

  let draft = $state<CatalogAdvancedSearchFilters>(
    untrack(() => $state.snapshot(filters)) as CatalogAdvancedSearchFilters,
  )

  const voteOptions = [
    { value: '', label: 'Any number of ratings' },
    { value: '50', label: '50+ ratings' },
    { value: '100', label: '100+ ratings' },
    { value: '500', label: '500+ ratings' },
    { value: '1000', label: '1,000+ ratings' },
    { value: '5000', label: '5,000+ ratings' },
    { value: '10000', label: '10,000+ ratings' },
  ]
  const languageOptions = $derived([
    { value: '', label: 'Any original language' },
    ...(options.languages ?? []),
  ])
  const countryOptions = $derived([
    { value: '', label: 'Any country of origin' },
    ...(options.countries ?? []),
  ])

  const set = (patch: Partial<CatalogAdvancedSearchFilters>) => (draft = { ...draft, ...patch })
  const scoreLabel = $derived(draft.minScore ? `${(draft.minScore / 10).toFixed(1)}+` : 'Any')

  function clearAll() {
    draft = { minScore: undefined, minVotes: undefined, language: undefined, country: undefined }
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
  aria-label="Advanced TMDB filters"
  tabindex="-1"
  data-nav-trap
  class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onClose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onClose() }}
>
  <div class="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl sm:max-h-[88vh]">
    <div class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div>
        <h2 class="text-lg font-black">Advanced TMDB filters</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">Narrow results by audience score, confidence, language, and origin.</p>
      </div>
      <button
        type="button"
        data-focusable
        onclick={onClose}
        aria-label="Close advanced filters"
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={18} />
      </button>
    </div>

    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
      {#if queryActive}
        <p class="rounded-lg bg-theme/10 px-3 py-2.5 text-xs text-muted-foreground">
          These filters narrow TMDB’s title matches. Clear the search text to browse the full filtered catalog.
        </p>
      {/if}

      <label class="grid gap-2 rounded-lg border border-border/70 p-3 text-sm font-semibold sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
        <span>Minimum rating <strong class="text-theme">{scoreLabel}</strong></span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          data-focusable
          value={draft.minScore ?? 0}
          oninput={(event) => set({ minScore: Number(event.currentTarget.value) || undefined })}
          aria-label="Minimum TMDB rating"
          class="w-full accent-theme"
        />
      </label>

      <section class="rounded-lg border border-border/70 p-3">
        <h3 class="mb-1 text-sm font-black">Rating confidence</h3>
        <p class="mb-2 text-xs text-muted-foreground">Avoid unusually high scores based on only a handful of ratings.</p>
        <SelectMenu
          value={draft.minVotes ? String(draft.minVotes) : ''}
          ariaLabel="Minimum number of TMDB ratings"
          className="w-full"
          options={voteOptions}
          onChange={(value) => set({ minVotes: value ? Number(value) : undefined })}
        />
      </section>

      <div class="grid gap-4 sm:grid-cols-2">
        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1 text-sm font-black">Original language</h3>
          <p class="mb-2 text-xs text-muted-foreground">The language the title was originally produced in.</p>
          <SelectMenu
            value={draft.language ?? ''}
            ariaLabel="Original language"
            className="w-full"
            options={languageOptions}
            onChange={(value) => set({ language: value || undefined })}
          />
        </section>

        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1 text-sm font-black">Country of origin</h3>
          <p class="mb-2 text-xs text-muted-foreground">Where the movie or series was produced.</p>
          <SelectMenu
            value={draft.country ?? ''}
            ariaLabel="Country of origin"
            className="w-full"
            options={countryOptions}
            onChange={(value) => set({ country: value || undefined })}
          />
        </section>
      </div>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <button
        type="button"
        data-focusable
        onclick={clearAll}
        class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >Clear advanced</button>
      <button
        type="button"
        data-focusable
        onclick={() => onApply($state.snapshot(draft) as CatalogAdvancedSearchFilters)}
        class="rounded-md bg-primary px-5 py-2 text-sm font-black text-primary-foreground transition hover:opacity-90"
      >Apply filters</button>
    </div>
  </div>
</div>
