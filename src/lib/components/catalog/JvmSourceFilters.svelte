<script lang="ts">
  import X from '@lucide/svelte/icons/x'
  import type { JvmSourceFilter } from '$lib/extensions/manager'
  import { onMount } from 'svelte'
  import { advancedFiltersOpen } from '$lib/player/session'

  let { sourceName, filters, onApply, onClose }: {
    sourceName: string
    filters: JvmSourceFilter[]
    onApply: (filters: JvmSourceFilter[]) => void
    onClose: () => void
  } = $props()

  let draft = $state<JvmSourceFilter[]>([])

  const copyFilters = (value: JvmSourceFilter[]): JvmSourceFilter[] =>
    JSON.parse(JSON.stringify(value)) as JvmSourceFilter[]

  $effect(() => {
    draft = copyFilters(filters)
  })

  onMount(() => {
    advancedFiltersOpen.set(true)
    return () => advancedFiltersOpen.set(false)
  })

  function update(index: number, state: unknown) {
    draft = draft.map((filter, current) => current === index ? { ...filter, state } : filter)
  }

  function updateGroup(index: number, childIndex: number, state: unknown) {
    const group = draft[index]
    const children = Array.isArray(group.state) ? group.state as JvmSourceFilter[] : []
    update(index, children.map((child, current) => current === childIndex ? { ...child, state } : child))
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onClose() }} />

<div
  class="fixed inset-0 z-[150] flex items-end justify-center bg-black/65 sm:items-center"
  role="dialog"
  aria-modal="true"
  aria-label="{sourceName} source filters"
  tabindex="-1"
  onclick={(event) => { if (event.target === event.currentTarget) onClose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onClose() }}
>
  <section
    class="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl"
  >
    <div class="mb-1 flex items-center justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-wide text-theme">{sourceName}</p>
        <h2 class="text-lg font-black">Source filters</h2>
      </div>
      <button type="button" data-focusable onclick={onClose} aria-label="Close source filters" class="grid size-10 place-items-center rounded-full bg-secondary hover:bg-accent">
        <X size={18} />
      </button>
    </div>
    <p class="mb-5 text-sm text-muted-foreground">These controls come directly from this Aniyomi source and are applied by the extension.</p>

    <div class="space-y-4">
      {#each draft as filter, index (`${index}:${filter.name}`)}
        {#if filter.type === 'Header'}
          <h3 class="border-b border-border/60 pb-2 pt-2 text-sm font-black">{filter.name}</h3>
        {:else if filter.type === 'Separator'}
          <hr class="border-border/60" />
        {:else if filter.type === 'CheckBox'}
          <label class="flex min-h-11 items-center justify-between gap-4 rounded-lg bg-secondary/45 px-3 text-sm font-bold">
            <span>{filter.name}</span>
            <input type="checkbox" checked={filter.state === true} onchange={(event) => update(index, event.currentTarget.checked)} class="size-5 accent-[hsl(var(--theme))]" />
          </label>
        {:else if filter.type === 'TriState'}
          <label class="block text-sm font-bold">
            <span class="mb-1.5 block">{filter.name}</span>
            <select data-focusable value={String(filter.state ?? 0)} onchange={(event) => update(index, Number(event.currentTarget.value))} class="h-11 w-full rounded-lg bg-input px-3 text-base">
              <option value="0">Any</option><option value="1">Include</option><option value="2">Exclude</option>
            </select>
          </label>
        {:else if filter.type === 'Select'}
          <label class="block text-sm font-bold">
            <span class="mb-1.5 block">{filter.name}</span>
            <select data-focusable value={String(filter.state ?? 0)} onchange={(event) => update(index, Number(event.currentTarget.value))} class="h-11 w-full rounded-lg bg-input px-3 text-base">
              {#each filter.values ?? [] as value, valueIndex}<option value={valueIndex}>{value}</option>{/each}
            </select>
          </label>
        {:else if filter.type === 'Sort'}
          {@const sort = (filter.state ?? {}) as { index?: number; ascending?: boolean }}
          <div class="grid grid-cols-[1fr_auto] gap-2">
            <label class="text-sm font-bold"><span class="mb-1.5 block">{filter.name}</span>
              <select data-focusable value={String(sort.index ?? 0)} onchange={(event) => update(index, { ...sort, index: Number(event.currentTarget.value) })} class="h-11 w-full rounded-lg bg-input px-3 text-base">
                {#each filter.values ?? [] as value, valueIndex}<option value={valueIndex}>{value}</option>{/each}
              </select>
            </label>
            <label class="self-end"><span class="sr-only">Sort direction</span>
              <select data-focusable value={sort.ascending === false ? 'desc' : 'asc'} onchange={(event) => update(index, { ...sort, ascending: event.currentTarget.value === 'asc' })} class="h-11 rounded-lg bg-input px-3 text-sm font-bold">
                <option value="asc">Ascending</option><option value="desc">Descending</option>
              </select>
            </label>
          </div>
        {:else if filter.type === 'Text'}
          <label class="block text-sm font-bold"><span class="mb-1.5 block">{filter.name}</span>
            <input data-focusable value={String(filter.state ?? '')} oninput={(event) => update(index, event.currentTarget.value)} class="h-11 w-full rounded-lg bg-input px-3 text-base" />
          </label>
        {:else if filter.type === 'Group'}
          <fieldset class="rounded-xl bg-secondary/35 p-3">
            <legend class="px-1 text-sm font-black">{filter.name}</legend>
            <div class="space-y-2">
              {#each (Array.isArray(filter.state) ? filter.state : []) as child, childIndex (`${childIndex}:${child.name}`)}
                {#if child.type === 'CheckBox'}
                  <label class="flex min-h-10 items-center justify-between gap-3 text-sm font-semibold"><span>{child.name}</span>
                    <input type="checkbox" checked={child.state === true} onchange={(event) => updateGroup(index, childIndex, event.currentTarget.checked)} class="size-5 accent-[hsl(var(--theme))]" />
                  </label>
                {:else if child.type === 'TriState'}
                  <label class="grid grid-cols-[1fr_auto] items-center gap-3 text-sm font-semibold"><span>{child.name}</span>
                    <select data-focusable value={String(child.state ?? 0)} onchange={(event) => updateGroup(index, childIndex, Number(event.currentTarget.value))} class="h-10 rounded-lg bg-input px-2">
                      <option value="0">Any</option><option value="1">Include</option><option value="2">Exclude</option>
                    </select>
                  </label>
                {:else if child.type === 'Text'}
                  <label class="block text-sm font-semibold"><span class="mb-1 block">{child.name}</span>
                    <input data-focusable value={String(child.state ?? '')} oninput={(event) => updateGroup(index, childIndex, event.currentTarget.value)} class="h-10 w-full rounded-lg bg-input px-3" />
                  </label>
                {:else if child.type === 'Select'}
                  <label class="block text-sm font-semibold"><span class="mb-1 block">{child.name}</span>
                    <select data-focusable value={String(child.state ?? 0)} onchange={(event) => updateGroup(index, childIndex, Number(event.currentTarget.value))} class="h-10 w-full rounded-lg bg-input px-2">
                      {#each child.values ?? [] as value, valueIndex}<option value={valueIndex}>{value}</option>{/each}
                    </select>
                  </label>
                {:else if child.type === 'Sort'}
                  {@const childSort = (child.state ?? {}) as { index?: number; ascending?: boolean }}
                  <div class="grid grid-cols-[1fr_auto] gap-2">
                    <label class="text-sm font-semibold"><span class="mb-1 block">{child.name}</span>
                      <select data-focusable value={String(childSort.index ?? 0)} onchange={(event) => updateGroup(index, childIndex, { ...childSort, index: Number(event.currentTarget.value) })} class="h-10 w-full rounded-lg bg-input px-2">
                        {#each child.values ?? [] as value, valueIndex}<option value={valueIndex}>{value}</option>{/each}
                      </select>
                    </label>
                    <label class="self-end"><span class="sr-only">Sort direction</span>
                      <select data-focusable value={childSort.ascending === false ? 'desc' : 'asc'} onchange={(event) => updateGroup(index, childIndex, { ...childSort, ascending: event.currentTarget.value === 'asc' })} class="h-10 rounded-lg bg-input px-2 text-xs font-bold">
                        <option value="asc">Ascending</option><option value="desc">Descending</option>
                      </select>
                    </label>
                  </div>
                {/if}
              {/each}
            </div>
          </fieldset>
        {/if}
      {/each}
    </div>

    <div class="sticky bottom-0 mt-6 flex justify-end bg-background pt-3">
      <button type="button" data-focusable onclick={() => onApply(copyFilters(draft))} class="min-h-11 rounded-lg bg-primary px-5 text-sm font-black text-primary-foreground">Apply filters</button>
    </div>
  </section>
</div>
