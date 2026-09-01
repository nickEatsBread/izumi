<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import MultiSelect from '$lib/components/search/MultiSelect.svelte'
  import { advancedFiltersOpen } from '$lib/player/session'
  import type { CatalogAdvancedSearchFilters, CatalogSearchOptions } from '$lib/catalog/types'

  let {
    filters,
    options,
    genres = [],
    queryActive = false,
    onApply,
    onClose,
  }: {
    filters: CatalogAdvancedSearchFilters
    options: CatalogSearchOptions
    genres?: string[]
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
  const minScoreLabel = $derived(draft.minScore ? `${(draft.minScore / 10).toFixed(1)}+` : 'Any')
  const maxScoreLabel = $derived(draft.maxScore ? `Up to ${(draft.maxScore / 10).toFixed(1)}` : 'Any')
  const datesInvalid = $derived(!!draft.releaseDateFrom && !!draft.releaseDateTo && draft.releaseDateFrom > draft.releaseDateTo)

  function setMinScore(raw: string) {
    const minScore = Number(raw) || undefined
    set({
      minScore,
      maxScore: minScore && draft.maxScore && minScore > draft.maxScore
        ? (minScore < 100 ? minScore : undefined)
        : draft.maxScore,
    })
  }

  function setMaxScore(raw: string) {
    const value = Number(raw)
    const maxScore = value < 100 ? value : undefined
    set({ maxScore, minScore: maxScore && draft.minScore && draft.minScore > maxScore ? maxScore : draft.minScore })
  }

  function clearAll() {
    draft = {
      minScore: undefined,
      maxScore: undefined,
      minVotes: undefined,
      language: undefined,
      country: undefined,
      releaseDateFrom: undefined,
      releaseDateTo: undefined,
      excludedGenres: undefined,
      withPoster: undefined,
    }
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
        <p class="mt-0.5 text-xs text-muted-foreground">Build a precise rating, release, genre, language, and artwork query.</p>
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

      <section class="space-y-3 rounded-lg border border-border/70 p-3">
        <div>
          <h3 class="text-sm font-black">Audience rating</h3>
          <p class="mt-0.5 text-xs text-muted-foreground">Set either edge of the TMDB user-score range.</p>
        </div>
        <label class="grid gap-2 text-sm font-semibold sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
          <span>Minimum rating <strong class="text-theme">{minScoreLabel}</strong></span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            data-focusable
            value={draft.minScore ?? 0}
            oninput={(event) => setMinScore(event.currentTarget.value)}
            aria-label="Minimum TMDB rating"
            class="w-full accent-theme"
          />
        </label>
        <label class="grid gap-2 text-sm font-semibold sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
          <span>Maximum rating <strong class="text-theme">{maxScoreLabel}</strong></span>
          <input
            type="range"
            min="5"
            max="100"
            step="5"
            data-focusable
            value={draft.maxScore ?? 100}
            oninput={(event) => setMaxScore(event.currentTarget.value)}
            aria-label="Maximum TMDB rating"
            class="w-full accent-theme"
          />
        </label>
      </section>

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

      <section class="rounded-lg border border-border/70 p-3">
        <h3 class="mb-1 text-sm font-black">Release window</h3>
        <p class="mb-2 text-xs text-muted-foreground">Movies use their primary release date; series use their first air date.</p>
        <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <input
            type="date"
            data-focusable
            value={draft.releaseDateFrom ?? ''}
            oninput={(event) => set({ releaseDateFrom: event.currentTarget.value || undefined })}
            aria-label="Released from"
            class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <span class="text-xs font-bold text-muted-foreground">to</span>
          <input
            type="date"
            data-focusable
            value={draft.releaseDateTo ?? ''}
            oninput={(event) => set({ releaseDateTo: event.currentTarget.value || undefined })}
            aria-label="Released through"
            class="min-w-0 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {#if datesInvalid}
          <p class="mt-2 text-xs font-semibold text-destructive">The end date must be on or after the start date.</p>
        {/if}
      </section>

      <div class="grid gap-4 sm:grid-cols-2">
        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1 text-sm font-black">Excluded genres</h3>
          <p class="mb-2 text-xs text-muted-foreground">Remove any title matching one or more of these genres.</p>
          <MultiSelect
            label="Choose genres"
            options={genres}
            selected={draft.excludedGenres ?? []}
            onchange={(values) => set({ excludedGenres: values.length ? values : undefined })}
          />
        </section>

        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1 text-sm font-black">Artwork</h3>
          <p class="mb-2 text-xs text-muted-foreground">Hide incomplete TMDB entries without poster art.</p>
          <label class="flex min-h-10 cursor-pointer items-center gap-2 rounded-md bg-secondary px-3 text-sm font-semibold">
            <input
              type="checkbox"
              data-focusable
              checked={!!draft.withPoster}
              onchange={(event) => set({ withPoster: event.currentTarget.checked || undefined })}
              class="accent-theme"
            />
            Require a poster
          </label>
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
        disabled={datesInvalid}
        onclick={() => onApply($state.snapshot(draft) as CatalogAdvancedSearchFilters)}
        class="rounded-md bg-primary px-5 py-2 text-sm font-black text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
      >Apply filters</button>
    </div>
  </div>
</div>
