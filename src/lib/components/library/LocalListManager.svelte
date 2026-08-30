<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'
  import { availableLocalLists, deleteLocalList, localLibrary, renameLocalList, reorderLocalList, WATCHLIST_ID } from '$lib/library/local-lists'
  import { m } from '$lib/paraglide/messages.js'

  let { onclose }: { onclose: () => void } = $props()
  const lists = $derived(availableLocalLists($localLibrary).filter((list) => list.id !== WATCHLIST_ID))
  let editing = $state<string | null>(null)
  let draft = $state('')
  let confirmDelete = $state<string | null>(null)

  function beginRename(id: string, name: string) { editing = id; draft = name; confirmDelete = null }
  function commitRename() {
    if (editing && renameLocalList(editing, draft)) editing = null
  }
  function remove(id: string) {
    if (confirmDelete !== id) { confirmDelete = id; return }
    deleteLocalList(id)
    confirmDelete = null
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />
<div class="fixed inset-0 z-[80] grid place-items-end bg-black/70 sm:place-items-center sm:p-4">
  <button class="absolute inset-0 cursor-default" onclick={onclose} aria-label={m.common_close()}></button>
  <div role="dialog" aria-modal="true" aria-label={m.lists_manage()} class="relative max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-black">{m.lists_manage()}</h2>
      <button data-focusable onclick={onclose} aria-label={m.common_close()} class="grid size-9 place-items-center rounded-lg hover:bg-accent"><X size={18} /></button>
    </div>
    {#if lists.length}
      <div class="space-y-2">
        {#each lists as list, index (list.id)}
          <div class="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-background/35 p-2">
            {#if editing === list.id}
              <form class="flex min-w-0 flex-1 gap-2" onsubmit={(event) => { event.preventDefault(); commitRename() }}>
                <input data-focusable bind:value={draft} maxlength="60" class="h-9 min-w-0 flex-1 rounded-lg bg-input px-3 text-sm" />
                <button data-focusable class="rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground">{m.lists_rename()}</button>
              </form>
            {:else}
              <span class="min-w-0 flex-1 truncate px-1 text-sm font-bold">{list.name}</span>
              <button data-focusable onclick={() => reorderLocalList(list.id, -1)} disabled={index === 0} aria-label={m.lists_move_up()} class="grid size-9 place-items-center rounded-lg hover:bg-accent disabled:opacity-30"><ChevronUp size={16} /></button>
              <button data-focusable onclick={() => reorderLocalList(list.id, 1)} disabled={index === lists.length - 1} aria-label={m.lists_move_down()} class="grid size-9 place-items-center rounded-lg hover:bg-accent disabled:opacity-30"><ChevronDown size={16} /></button>
              <button data-focusable onclick={() => beginRename(list.id, list.name)} aria-label={m.lists_rename()} class="grid size-9 place-items-center rounded-lg hover:bg-accent"><Pencil size={16} /></button>
              <button data-focusable onclick={() => remove(list.id)} aria-label={m.lists_delete()} class="h-9 rounded-lg px-2 text-xs font-bold text-red-400 hover:bg-red-500/10"><Trash2 size={16} class="inline" />{confirmDelete === list.id ? ` ${m.lists_delete()}?` : ''}</button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="rounded-xl bg-secondary p-4 text-sm text-muted-foreground">{m.lists_empty_custom()}</p>
    {/if}
  </div>
</div>
