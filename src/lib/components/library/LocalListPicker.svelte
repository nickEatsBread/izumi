<script lang="ts">
  import { onMount } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import {
    WATCHLIST_ID, availableLocalLists, createLocalList, localLibrary,
    mediaIsInLocalList, setMediaInLocalList,
  } from '$lib/library/local-lists'
  import Check from '@lucide/svelte/icons/check'
  import Plus from '@lucide/svelte/icons/plus'
  import X from '@lucide/svelte/icons/x'

  let { media, onclose }: { media: Media; onclose: () => void } = $props()
  let newListName = $state('')
  let dialog = $state<HTMLElement>()
  const lists = $derived(availableLocalLists($localLibrary))

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('[data-list-option]')?.focus({ preventScroll: true }))
    return () => {
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }))
    }
  })

  function toggle(listId: string) {
    setMediaInLocalList(media, listId, !mediaIsInLocalList($localLibrary, media, listId))
  }

  function create() {
    const id = createLocalList(newListName)
    if (!id) return
    setMediaInLocalList(media, id, true)
    newListName = ''
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div
  bind:this={dialog}
  role="dialog" aria-modal="true" aria-label="Save to lists" tabindex="-1"
  class="fixed inset-0 z-[70] grid h-[100dvh] place-items-end bg-black/70 sm:place-items-center sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onclose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onclose() }}
>
  <div class="flex max-h-[min(36rem,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
    <div class="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
      <div>
        <h2 class="text-lg font-black">Save to lists</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">Stored on this device. No account needed.</p>
      </div>
      <button data-focusable aria-label="Close" onclick={onclose} class="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-accent"><X size={18} /></button>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-2">
      {#each lists as list (list.id)}
        {@const selected = mediaIsInLocalList($localLibrary, media, list.id)}
        <button type="button" data-focusable data-list-option aria-pressed={selected} onclick={() => toggle(list.id)}
          class="flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors
            {selected ? 'border-theme/45 bg-theme/10' : 'border-border bg-background/35 hover:bg-secondary'}">
          <span class="grid size-5 shrink-0 place-items-center rounded-md border {selected ? 'border-theme bg-theme text-theme-foreground' : 'border-foreground/25'}">
            {#if selected}<Check size={14} strokeWidth={3} />{/if}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-bold">{list.name}</span>
            {#if list.id === WATCHLIST_ID}<span class="block text-[0.68rem] text-muted-foreground">Appears in Schedule</span>{/if}
          </span>
        </button>
      {/each}
    </div>

    <form class="flex gap-2 border-t border-border px-5 py-3" onsubmit={(event) => { event.preventDefault(); create() }}>
      <label class="min-w-0 flex-1">
        <span class="sr-only">New list name</span>
        <input data-focusable bind:value={newListName} maxlength="60" placeholder="Create a new list…"
          class="h-11 w-full rounded-xl bg-input px-3 text-base outline-none focus:ring-2 focus:ring-theme sm:text-sm" />
      </label>
      <button type="submit" data-focusable disabled={!newListName.trim()}
        class="flex h-11 items-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-bold transition-colors hover:bg-accent disabled:opacity-40">
        <Plus size={16} /> Add
      </button>
    </form>
    <div class="px-5 pb-5">
      <button data-focusable onclick={onclose} class="h-11 w-full rounded-xl bg-primary font-black text-primary-foreground">Done</button>
    </div>
  </div>
</div>
