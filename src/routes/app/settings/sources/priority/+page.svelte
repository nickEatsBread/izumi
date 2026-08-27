<script lang="ts">
  import { sourcePriority, sourcePriorityMode } from '$lib/settings/ui'
  import type { SourcePriorityMode } from '$lib/stremio/source-priority'
  import { priorityCandidates } from '$lib/settings/source-origins'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import ChevronsUp from '@lucide/svelte/icons/chevrons-up'
  import ListOrdered from '@lucide/svelte/icons/list-ordered'
  import Plus from '@lucide/svelte/icons/plus'
  import X from '@lucide/svelte/icons/x'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import * as h from '$lib/haptics'

  const candidateById = $derived(new Map($priorityCandidates.map((c) => [c.id, c])))
  const unchosenSources = $derived($priorityCandidates.filter((c) => !$sourcePriority.includes(c.id)))

  function addPriority(id: string) {
    h.tap()
    if (!$sourcePriority.includes(id)) $sourcePriority = [...$sourcePriority, id]
  }
  function removePriority(id: string) {
    h.tap()
    $sourcePriority = $sourcePriority.filter((x) => x !== id)
  }
  function movePriority(from: number, to: number) {
    if (to < 0 || to >= $sourcePriority.length) return
    h.tap()
    const next = [...$sourcePriority]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    $sourcePriority = next
  }
  function clearAll() {
    h.tap()
    $sourcePriority = []
  }

  const priorityModes: { value: SourcePriorityMode; label: string; hint: string }[] = [
    { value: 'prefer', label: 'Prefer', hint: 'Try these first. Other sources are still used when the listed ones have nothing.' },
    { value: 'strict', label: 'Strict', hint: 'Use only these sources. Nothing else is offered, even when they come back empty.' },
  ]
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Source priority</h2>
  <p class="mb-6 max-w-2xl text-sm text-muted-foreground">
    The order to trust your sources in, most trusted first. It settles ties the ranking
    already makes — a listed source is preferred within its quality tier, never ahead of a cached copy
    or your audio language.
  </p>

  <div class="max-w-2xl space-y-8">
    <section aria-labelledby="priority-order-heading">
      <div class="mb-2 flex items-end justify-between gap-3">
        <h3 id="priority-order-heading" class="text-sm font-black">Your order</h3>
        {#if $sourcePriority.length}
          <button data-focusable onclick={clearAll}
            class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground transition-colors active:bg-accent sm:px-2 sm:py-1 sm:text-xs sm:hover:bg-accent">
            Clear order
          </button>
        {/if}
      </div>

      {#if $sourcePriority.length}
        <!-- Buttons, not drag-and-drop: the same screen has to work with a finger on Android and
             with the d-pad in Game mode, and neither can drag. -->
        <ol class="space-y-2">
          {#each $sourcePriority as id, i (id)}
            {@const source = candidateById.get(id)}
            <li class="rounded-xl border border-border bg-card p-3">
              <div class="flex items-center gap-3">
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-black tabular-nums">{i + 1}</span>
                <AddonLogo logo={source?.logo} name={source?.name ?? 'Unavailable source'} id={id} size={32} />
                <div class="min-w-0 flex-1">
                  <span class="block truncate font-bold">{source?.name ?? 'Unavailable source'}</span>
                  <span class="text-xs text-muted-foreground">
                    {#if source}{source.kind}{:else}Not among your enabled sources any more{/if}
                  </span>
                </div>
                <button data-focusable onclick={() => removePriority(id)} aria-label="Remove {source?.name ?? 'source'} from the order"
                  class="grid size-10 shrink-0 place-items-center rounded-lg text-destructive transition-colors hover:bg-accent active:bg-accent">
                  <X size={18} />
                </button>
              </div>

              {#if !source}
                <p class="mt-2 text-xs text-muted-foreground">
                  Switch it back on under Sources to use it again, or drop it from the order.
                </p>
              {/if}

              <!-- The move controls get their own row so each one is a full-height touch target
                   instead of a 24px icon wedged between the name and the switch. -->
              <div class="mt-2 grid grid-cols-3 gap-2">
                <button data-focusable onclick={() => movePriority(i, 0)} disabled={i === 0}
                  aria-label="Move {source?.name ?? 'source'} to the top"
                  class="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">
                  <ChevronsUp size={16} /> Top
                </button>
                <button data-focusable onclick={() => movePriority(i, i - 1)} disabled={i === 0}
                  aria-label="Move {source?.name ?? 'source'} up"
                  class="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">
                  <ChevronUp size={16} /> Up
                </button>
                <button data-focusable onclick={() => movePriority(i, i + 1)} disabled={i === $sourcePriority.length - 1}
                  aria-label="Move {source?.name ?? 'source'} down"
                  class="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">
                  <ChevronDown size={16} /> Down
                </button>
              </div>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="rounded-xl border border-dashed border-border p-4 text-center">
          <ListOrdered size={22} class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-sm font-bold">No order set</p>
          <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            This is the normal setup: every source is ranked on its own merits — cached copies first,
            then your quality and audio preferences, seeders and release. Add one below only to put a
            provider you trust ahead of that order.
          </p>
        </div>
      {/if}
    </section>

    {#if $sourcePriority.length}
      <section aria-labelledby="priority-mode-heading">
        <h3 id="priority-mode-heading" class="mb-1 text-sm font-black">How strictly to apply it</h3>
        <p class="mb-2 text-xs text-muted-foreground">What happens to the sources you did not list.</p>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each priorityModes as opt (opt.value)}
            <button
              data-focusable
              onclick={() => { h.tap(); $sourcePriorityMode = opt.value }}
              aria-pressed={$sourcePriorityMode === opt.value}
              class="rounded-xl border p-3 text-left transition-colors
                {$sourcePriorityMode === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
            >
              <div class="flex items-center justify-between">
                <span class="font-bold">{opt.label}</span>
                {#if $sourcePriorityMode === opt.value}<span class="text-xs font-bold text-primary">Selected</span>{/if}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <section aria-labelledby="priority-add-heading">
      <h3 id="priority-add-heading" class="mb-2 text-sm font-black">
        {$sourcePriority.length ? 'Add another source' : 'Your sources'}
      </h3>
      <ul class="space-y-2">
        {#each unchosenSources as source (source.id)}
          <li>
            <button data-focusable onclick={() => addPriority(source.id)}
              class="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-secondary active:bg-secondary">
              <AddonLogo logo={source.logo} name={source.name} id={source.id} size={36} />
              <div class="min-w-0 flex-1">
                <span class="block truncate font-bold">{source.name}</span>
                <span class="text-xs text-muted-foreground">{source.kind}</span>
              </div>
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary"><Plus size={18} /></span>
            </button>
          </li>
        {/each}
        {#if !unchosenSources.length}
          <li class="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
            {#if !$priorityCandidates.length}Nothing to order yet — add a source under Sources.
            {:else}Every source you have is already in the order.{/if}
          </li>
        {/if}
      </ul>
    </section>
  </div>
</div>
