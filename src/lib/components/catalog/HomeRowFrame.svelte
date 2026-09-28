<script lang="ts">
  import { setContext, type Snippet } from 'svelte'
  import { ROW_CONTEXT, type RowScope } from '$lib/themes/presentation'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import {
    hideHomeRow,
    homeEditorInsertRequest,
    homeEditorOpen,
    moveHomeRowBefore,
    moveHomeRowBy,
  } from '$lib/catalog/home-editor'
  import { homeBlockSettingsId, removeHomeBlock } from '$lib/home/block-rows'
  import { isBlockId } from '$lib/home/blocks'
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import GripVertical from '@lucide/svelte/icons/grip-vertical'
  import Plus from '@lucide/svelte/icons/plus'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import Trash2 from '@lucide/svelte/icons/trash-2'

  let {
    rowId,
    title,
    target,
    visibleIds,
    children,
    locked = false,
  }: {
    rowId: string
    title: string
    target: CatalogHomeTarget
    visibleIds: string[]
    children: Snippet
    /** A theme layout is active: children render inert with only the title chrome — no drag,
     * reorder, hide/settings/remove controls or "Add here" gap. Outside Edit Home this is a no-op. */
    locked?: boolean
  } = $props()

  setContext<() => RowScope>(ROW_CONTEXT, () => ({ id: `${target}:${rowId}`, title }))

  let dragging = $state(false)
  let pointerId = $state<number | null>(null)
  let startY = 0
  const index = $derived(visibleIds.indexOf(rowId))
  const block = $derived(isBlockId(rowId))

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || !$homeEditorOpen) return
    event.preventDefault()
    pointerId = event.pointerId
    startY = event.clientY
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    if (!dragging && Math.abs(event.clientY - startY) < 5) return
    dragging = true

    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-home-row]')
    const hoveredId = hovered?.dataset.homeRow
    if (!hovered || !hoveredId || !visibleIds.includes(hoveredId)) return
    const bounds = hovered.getBoundingClientRect()
    const hoveredIndex = visibleIds.indexOf(hoveredId)
    const insertAfter = event.clientY > bounds.top + bounds.height / 2
    const beforeId = insertAfter ? visibleIds[hoveredIndex + 1] ?? null : hoveredId
    moveHomeRowBefore(target, visibleIds, rowId, beforeId)
  }

  function endDrag(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    const handle = event.currentTarget as HTMLElement
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    pointerId = null
    dragging = false
  }
</script>

{#if $homeEditorOpen}
  <div class="relative px-2 sm:px-4">
    {#if !locked}
    <div class="group flex h-10 items-center justify-center">
      <span class="h-px flex-1 bg-theme/0 transition-colors group-hover:bg-theme/40"></span>
      <button
        type="button"
        data-focusable
        aria-label={`Add a section before ${title}`}
        onclick={() => homeEditorInsertRequest.set({ target, beforeId: rowId })}
        class="mx-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-theme/35 bg-background/95 px-3 text-xs font-black text-theme opacity-70 shadow-lg transition hover:border-theme hover:bg-theme hover:text-white hover:opacity-100 focus:opacity-100"
      >
        <Plus size={14} strokeWidth={3} /> Add here
      </button>
      <span class="h-px flex-1 bg-theme/0 transition-colors group-hover:bg-theme/40"></span>
    </div>
    {/if}

    <section
      data-home-row={rowId}
      aria-label={`${title} Home section`}
      class="overflow-hidden rounded-2xl border bg-background/90 shadow-xl transition
        {dragging ? 'scale-[0.985] border-theme ring-2 ring-theme/35 opacity-65' : 'border-border/80'}"
    >
      <div class="flex min-h-12 items-center gap-2 border-b border-border/70 bg-card/95 px-2 sm:px-3">
        {#if !locked}
        <button
          type="button"
          data-focusable
          aria-label={`Drag ${title}`}
          title="Drag to reorder"
          onpointerdown={startDrag}
          onpointermove={moveDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          class="grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical size={20} />
        </button>
        {/if}
        <span class="min-w-0 flex-1 truncate text-sm font-black">{title}</span>
        {#if !locked}
        <div class="flex shrink-0 items-center">
          <button type="button" data-focusable disabled={index <= 0} onclick={() => moveHomeRowBy(target, visibleIds, rowId, -1)} aria-label={`Move ${title} up`} class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-20"><ArrowUp size={17} /></button>
          <button type="button" data-focusable disabled={index < 0 || index >= visibleIds.length - 1} onclick={() => moveHomeRowBy(target, visibleIds, rowId, 1)} aria-label={`Move ${title} down`} class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-20"><ArrowDown size={17} /></button>
          {#if block}
            <button type="button" data-focusable onclick={() => homeBlockSettingsId.set(rowId)} aria-label={`Settings for ${title}`} title="Block settings" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><SlidersHorizontal size={17} /></button>
            <button type="button" data-focusable onclick={() => removeHomeBlock(target, rowId)} aria-label={`Remove ${title}`} title="Remove block" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive"><Trash2 size={17} /></button>
          {:else}
            <button type="button" data-focusable onclick={() => hideHomeRow(target, visibleIds, rowId)} aria-label={`Hide ${title}`} title="Hide section" class="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/15 hover:text-destructive"><EyeOff size={17} /></button>
          {/if}
        </div>
        {/if}
      </div>
      <div class="pointer-events-none select-none py-3 opacity-90" inert>
        {@render children()}
      </div>
    </section>
  </div>
{:else}
  {@render children()}
{/if}
