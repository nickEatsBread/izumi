<script lang="ts">
  import { untrack, onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { searchCountQuery, searchVariables, MEDIA_SOURCES, COUNTRIES, type SearchFilters } from '$lib/anilist/detail-queries'
  import { showAdult } from '$lib/settings/ui'
  import { advancedFiltersOpen } from '$lib/player/session'
  import TagPicker from './TagPicker.svelte'
  import MultiSelect from './MultiSelect.svelte'
  import X from 'lucide-svelte/icons/x'

  let { filters, onApply, onClose }: {
    filters: SearchFilters
    onApply: (next: SearchFilters) => void
    onClose: () => void
  } = $props()

  // Flag the modal open so the Game-mode controller translator routes B → close (not page-back);
  // it signals the close via an 'advanced-close' window event (the pad can't call onClose directly).
  onMount(() => {
    advancedFiltersOpen.set(true)
    const close = () => onClose()
    window.addEventListener('advanced-close', close)
    return () => { advancedFiltersOpen.set(false); window.removeEventListener('advanced-close', close) }
  })

  // Edit a DRAFT clone captured once when the modal opens; nothing re-queries the page
  // behind the dim until Apply (untrack = intentionally read filters' value at mount only).
  let draft = $state<SearchFilters>(untrack(() => $state.snapshot(filters)) as SearchFilters)

  const client = getContextClient()
  let count = $state<number | null>(null)
  let counting = $state(false)

  // Debounced count-only query → "Apply · N". Re-runs on any draft change (and reads the
  // current 18+ setting via searchCountQuery). Never throws out to the UI.
  $effect(() => {
    const vars = { ...searchVariables($state.snapshot(draft) as SearchFilters), perPage: 1 }
    void $showAdult
    counting = true
    const t = setTimeout(async () => {
      try {
        const r = await client.query(searchCountQuery(), vars, { requestPolicy: 'network-only' }).toPromise()
        count = (r.data as { Page?: { pageInfo?: { total?: number } } } | undefined)?.Page?.pageInfo?.total ?? null
      } catch { count = null } finally { counting = false }
    }, 350)
    return () => clearTimeout(t)
  })

  const set = (patch: Partial<SearchFilters>) => (draft = { ...draft, ...patch })
  const num = (s: string) => (s === '' ? undefined : Number(s))

  function clearAll() {
    draft = {
      ...draft,
      tagsIn: undefined, tagsNotIn: undefined, minTagRank: undefined,
      sources: undefined, country: undefined, minScore: undefined, epMin: undefined, epMax: undefined,
    }
  }
</script>

<div
  role="dialog" aria-modal="true" aria-label="Advanced filters" tabindex="-1" data-nav-trap
  class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 sm:p-4"
  onclick={(e) => { if (e.target === e.currentTarget) onClose() }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose() }}
>
  <div class="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl sm:max-h-[88vh]">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <h2 class="text-lg font-black">Advanced filters</h2>
      <button data-focusable onclick={onClose} aria-label="Close"
              class="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <X size={18} />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <!-- Tags (include / exclude) -->
      <section class="grid gap-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-black">Tags</h3>
          <span class="shrink-0 text-xs text-muted-foreground">
            {(draft.tagsIn?.length ?? 0)} included · {(draft.tagsNotIn?.length ?? 0)} excluded
          </span>
        </div>
        <div class="h-72 min-h-48 max-h-[36vh] overflow-hidden rounded-lg border border-border/70 bg-secondary/20 p-3">
          <TagPicker include={draft.tagsIn ?? []} exclude={draft.tagsNotIn ?? []}
                     onchange={(inc, exc) => set({ tagsIn: inc, tagsNotIn: exc })} />
        </div>
        <label class="grid gap-2 rounded-lg bg-secondary/40 px-3 py-2.5 text-xs font-semibold text-muted-foreground sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
          <span>Min tag rank <strong class="text-foreground">{draft.minTagRank ?? 0}%</strong></span>
          <input type="range" min="0" max="100" step="5" data-focusable
                 value={draft.minTagRank ?? 0} oninput={(e) => set({ minTagRank: Number(e.currentTarget.value) || undefined })}
                 class="w-full accent-theme" />
        </label>
      </section>

      <div class="grid gap-4 sm:grid-cols-2">
        <!-- Source material -->
        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1.5 text-sm font-black">Source</h3>
          <MultiSelect label="Source" options={MEDIA_SOURCES} selected={draft.sources ?? []}
                       onchange={(v) => set({ sources: v })} />
        </section>
        <!-- Country of origin (single-select) -->
        <section class="rounded-lg border border-border/70 p-3">
          <h3 class="mb-1.5 text-sm font-black">Country</h3>
          <select data-focusable value={draft.country ?? ''}
                  onchange={(e) => set({ country: e.currentTarget.value || undefined })}
                  class="w-full rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent">
            <option value="">Any country</option>
            {#each COUNTRIES as c (c.code)}<option value={c.code}>{c.label}</option>{/each}
          </select>
        </section>
      </div>

      <!-- Min score -->
      <label class="grid gap-2 rounded-lg border border-border/70 p-3 text-sm font-semibold sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
        <span>Min score <strong>{draft.minScore ?? 0}%</strong></span>
        <input type="range" min="0" max="100" step="5" data-focusable
               value={draft.minScore ?? 0} oninput={(e) => set({ minScore: Number(e.currentTarget.value) || undefined })}
               class="w-full accent-theme" />
      </label>

      <!-- Episode range -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-border/70 p-3 text-sm font-semibold sm:grid-cols-[8rem_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <span class="col-span-3 sm:col-span-1">Episodes</span>
        <input type="number" min="0" placeholder="min" data-focusable
               value={draft.epMin ?? ''} oninput={(e) => set({ epMin: num(e.currentTarget.value) })}
               aria-label="Minimum episodes"
               class="min-w-0 w-full rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
        <span class="text-muted-foreground">–</span>
        <input type="number" min="0" placeholder="max" data-focusable
               value={draft.epMax ?? ''} oninput={(e) => set({ epMax: num(e.currentTarget.value) })}
               aria-label="Maximum episodes"
               class="min-w-0 w-full rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
      </div>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <button data-focusable onclick={clearAll}
              class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        Clear all
      </button>
      <button data-focusable onclick={() => onApply($state.snapshot(draft) as SearchFilters)}
              class="rounded-md bg-primary px-5 py-2 text-sm font-black text-primary-foreground transition hover:opacity-90">
        Apply{counting ? ' …' : count != null ? ` · ${count}` : ''}
      </button>
    </div>
  </div>
</div>
