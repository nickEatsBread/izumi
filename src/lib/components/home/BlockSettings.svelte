<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import X from '@lucide/svelte/icons/x'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { CatalogHomeRowOption } from '$lib/catalog/types'
  import { blockTitle, updateHomeBlock } from '$lib/home/block-rows'
  import { BLOCK_LIMITS, BLOCK_META, TOP_GENRES, homeAsideWidth, homeBlocks, type BlockButton, type HomeBlock } from '$lib/home/blocks'
  import { loadGenres } from '$lib/home/genres'
  import { NAV_META, type NavItemId } from '$lib/settings/nav'

  // Settings for one Home block, opened from its frame in Edit Home. Every change is repaired and saved at once.
  let { id, target, rows, onclose }: { id: string; target: CatalogHomeTarget; rows: CatalogHomeRowOption[]; onclose: () => void } = $props()

  const block = $derived($homeBlocks[id])
  const set = (patch: Partial<HomeBlock>) => updateHomeBlock(id, patch)

  const COLUMN_CHOICES = [2, 3, 4, 5, 6, 8]
  const PAGE_CHOICES = [8, 12, 16, 18, 24, 30, 36, 48]
  const LIMIT_CHOICES = [5, 10, 15, 20]
  const PAGINATION_CHOICES = [{ value: 'numbers', label: 'Page numbers' }, { value: 'more', label: 'Load more' }, { value: 'none', label: 'One page' }] as const
  const DESTINATIONS: BlockButton[] = [{ label: 'Home', to: 'home' }, ...(Object.keys(NAV_META) as NavItemId[]).map((to) => ({ label: NAV_META[to].label, to }))]

  let catalogGenres = $state<string[]>([])
  $effect(() => {
    if (block?.type !== 'genre-chips') return
    const abort = new AbortController()
    loadGenres(target, abort.signal).then((genres) => { if (!abort.signal.aborted) catalogGenres = genres }).catch(() => {})
    return () => abort.abort()
  })

  function toggleTab(row: CatalogHomeRowOption, on: boolean, max: number) {
    if (block?.type !== 'tabbed-grid' && block?.type !== 'ranked-list') return
    const tabs = on
      ? [...block.tabs, { label: row.title.slice(0, BLOCK_LIMITS.label), role: row.id }].slice(0, max)
      : block.tabs.filter((tab) => tab.role !== row.id)
    set({ tabs })
  }

  function renameTab(role: string, label: string) {
    if (block?.type !== 'tabbed-grid' && block?.type !== 'ranked-list') return
    set({ tabs: block.tabs.map((tab) => (tab.role === role ? { ...tab, label: label.trim() || tab.label } : tab)) })
  }

  const pressed = (on: boolean) => on ? 'border-theme bg-theme/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
</script>

{#if block}
  <button type="button" tabindex="-1" aria-label="Close block settings" onclick={onclose} class="fixed inset-0 z-[74] bg-black/70 backdrop-blur-sm" transition:fade={{ duration: 120 }}></button>
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[75] flex max-h-[min(84vh,46rem)] justify-center sm:inset-0 sm:items-center sm:p-5">
    <div role="dialog" aria-modal="true" aria-labelledby="block-settings-title" data-nav-trap class="pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:max-w-lg sm:rounded-3xl" transition:fly={{ y: 22, duration: 170 }}>
      <div class="flex items-start gap-3 border-b border-border px-5 pb-4 pt-5">
        <div class="min-w-0 flex-1">
          <h2 id="block-settings-title" class="text-lg font-black">{blockTitle(block)}</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">{BLOCK_META[block.type].description}</p>
        </div>
        <button type="button" data-focusable aria-label="Close" onclick={onclose} class="grid size-10 shrink-0 place-items-center rounded-full hover:bg-secondary"><X size={19} /></button>
      </div>

      <div class="space-y-5 overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <label class="block">
          <span class="text-sm font-bold">Heading</span>
          <input data-focusable type="text" maxlength={BLOCK_LIMITS.title} value={block.title ?? ''} placeholder={BLOCK_META[block.type].title}
            onchange={(event) => set({ title: event.currentTarget.value })}
            class="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-theme/70" />
        </label>

        {#if block.type === 'latest-episodes' || block.type === 'tabbed-grid'}
          <div class="grid grid-cols-3 gap-3">
            <label class="block"><span class="text-sm font-bold">Columns</span>
              <select data-focusable value={block.columns} onchange={(event) => set({ columns: Number(event.currentTarget.value) })} class="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-2 text-sm">
                {#each COLUMN_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
              </select>
            </label>
            <label class="block"><span class="text-sm font-bold">Per page</span>
              <select data-focusable value={block.pageSize} onchange={(event) => set({ pageSize: Number(event.currentTarget.value) })} class="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-2 text-sm">
                {#each PAGE_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
              </select>
            </label>
            <label class="block"><span class="text-sm font-bold">Pages</span>
              <select data-focusable value={block.pagination} onchange={(event) => set({ pagination: event.currentTarget.value as 'numbers' | 'more' | 'none' })} class="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-2 text-sm">
                {#each PAGINATION_CHOICES as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
              </select>
            </label>
          </div>
        {/if}

        {#if block.type === 'tabbed-grid' || block.type === 'ranked-list'}
          {@const max = block.type === 'tabbed-grid' ? BLOCK_LIMITS.tabs : BLOCK_LIMITS.rankedTabs}
          <fieldset>
            <legend class="text-sm font-bold">Rows <span class="font-normal text-muted-foreground">· up to {max}, shown as tabs</span></legend>
            <div class="mt-1.5 space-y-0.5">
              {#each rows as row (row.id)}
                {@const tab = block.tabs.find((item) => item.role === row.id)}
                <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/50">
                  <input data-focusable type="checkbox" id={`block-tab-${row.id}`} checked={!!tab} disabled={!tab && block.tabs.length >= max}
                    onchange={(event) => toggleTab(row, event.currentTarget.checked, max)} class="size-4 shrink-0" />
                  <label for={`block-tab-${row.id}`} class="min-w-0 flex-1 truncate text-sm">{row.title}</label>
                  {#if tab}
                    <input data-focusable type="text" aria-label={`Tab label for ${row.title}`} maxlength={BLOCK_LIMITS.label} value={tab.label}
                      onchange={(event) => renameTab(row.id, event.currentTarget.value)} class="h-8 w-36 rounded-md border border-border bg-card px-2 text-xs" />
                  {/if}
                </div>
              {:else}
                <p class="px-2 text-sm text-muted-foreground">This Home has no catalog rows to show.</p>
              {/each}
            </div>
          </fieldset>
        {/if}

        {#if block.type === 'ranked-list'}
          <label class="block"><span class="text-sm font-bold">Titles</span>
            <select data-focusable value={block.limit} onchange={(event) => set({ limit: Number(event.currentTarget.value) })} class="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-2 text-sm">
              {#each LIMIT_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
            </select>
          </label>
        {/if}

        {#if block.type === 'genre-chips'}
          {@const custom = block.genres === 'top' ? null : block.genres}
          {@const choices = [...new Set([...TOP_GENRES, ...catalogGenres, ...(custom ?? [])])]}
          <fieldset>
            <legend class="text-sm font-bold">Genres</legend>
            <div class="mt-1.5 grid grid-cols-2 gap-2">
              <button type="button" data-focusable aria-pressed={!custom} onclick={() => set({ genres: 'top' })} class="min-h-10 rounded-lg border text-sm font-bold {pressed(!custom)}">Popular genres</button>
              <button type="button" data-focusable aria-pressed={!!custom} onclick={() => set({ genres: custom ?? TOP_GENRES.slice(0, 8) })} class="min-h-10 rounded-lg border text-sm font-bold {pressed(!!custom)}">Choose</button>
            </div>
            {#if custom}
              <div class="mt-3 flex flex-wrap gap-1.5">
                {#each choices as genre (genre)}
                  {@const on = custom.includes(genre)}
                  <button type="button" data-focusable aria-pressed={on} onclick={() => set({ genres: on ? custom.filter((item) => item !== genre) : [...custom, genre] })}
                    class="rounded-full px-3 py-1 text-xs font-bold {on ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}">{genre}</button>
                {/each}
              </div>
            {/if}
            <label class="mt-3 flex items-center gap-2 text-sm"><input data-focusable type="checkbox" checked={block.all} onchange={(event) => set({ all: event.currentTarget.checked })} class="size-4" /> Show an “All” chip</label>
          </fieldset>
        {/if}

        {#if block.type === 'profile-header'}
          <fieldset>
            <legend class="text-sm font-bold">Buttons <span class="font-normal text-muted-foreground">· up to {BLOCK_LIMITS.buttons}</span></legend>
            <div class="mt-1.5 grid grid-cols-2 gap-1">
              {#each DESTINATIONS as destination (destination.to)}
                {@const on = block.buttons.some((button) => button.to === destination.to)}
                <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-secondary/50">
                  <input data-focusable type="checkbox" checked={on} disabled={!on && block.buttons.length >= BLOCK_LIMITS.buttons} class="size-4"
                    onchange={(event) => set({ buttons: event.currentTarget.checked ? [...block.buttons, destination] : block.buttons.filter((button) => button.to !== destination.to) })} />
                  {destination.label}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}

        <fieldset>
          <legend class="text-sm font-bold">Placement</legend>
          <div class="mt-1.5 grid grid-cols-2 gap-2">
            <button type="button" data-focusable aria-pressed={block.area === 'main'} onclick={() => set({ area: 'main' })} class="min-h-10 rounded-lg border text-sm font-bold {pressed(block.area === 'main')}">Main column</button>
            <button type="button" data-focusable aria-pressed={block.area === 'aside'} onclick={() => set({ area: 'aside' })} class="min-h-10 rounded-lg border text-sm font-bold {pressed(block.area === 'aside')}">Side column</button>
          </div>
          {#if block.area === 'aside'}
            <p class="mt-2 text-xs text-muted-foreground">The side column sits beside Home on wide windows and after it on narrow ones.</p>
            <label class="mt-2 flex items-center gap-2 text-sm"><input data-focusable type="checkbox" checked={block.phone} onchange={(event) => set({ phone: event.currentTarget.checked })} class="size-4" /> Also show on phones</label>
            <label class="mt-3 block text-sm">
              <span class="font-bold">Side column width</span> <span class="text-muted-foreground">{$homeAsideWidth}px</span>
              <input data-focusable type="range" min="240" max="420" step="10" value={$homeAsideWidth} oninput={(event) => homeAsideWidth.set(Number(event.currentTarget.value))} class="mt-1.5 w-full" />
            </label>
          {/if}
        </fieldset>
      </div>
    </div>
  </div>
{/if}
