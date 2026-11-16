<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { title } from '$lib/anilist/media'
  import {
    WATCHLIST_ID, availableLocalLists, createLocalList, localLibrary,
    mediaIsInLocalList, setMediaInLocalList,
  } from '$lib/library/local-lists'
  import OptionsSheet, { type SheetGroup } from '$lib/components/detail/OptionsSheet.svelte'
  import SquareCheck from '@lucide/svelte/icons/square-check'
  import Square from '@lucide/svelte/icons/square'
  import Plus from '@lucide/svelte/icons/plus'

  // The options side sheet, so a controller gets what a mouse does: the lists in a trapped panel,
  // A ticks one and stays, B (or a tap outside) closes and hands focus back to what opened it.
  let { media, onclose }: { media: Media; onclose: () => void } = $props()
  let newListName = $state('')
  const lists = $derived(availableLocalLists($localLibrary))

  const groups = $derived<SheetGroup[]>([{
    options: lists.map((list) => {
      const on = mediaIsInLocalList($localLibrary, media, list.id)
      return {
        id: `list-${list.id}`,
        label: list.name,
        detail: list.id === WATCHLIST_ID ? 'Appears in Schedule' : undefined,
        icon: on ? SquareCheck : Square,
        pressed: on,
        keepOpen: true,
        onselect: () => setMediaInLocalList(media, list.id, !on),
      }
    }),
  }])

  function create() {
    const id = createLocalList(newListName)
    if (!id) return
    setMediaInLocalList(media, id, true)
    newListName = ''
  }
</script>

<OptionsSheet title="Save to lists" subtitle={`${title(media)} · Stored on this device. No account needed.`} {groups} {onclose}>
  {#snippet footer()}
    <form class="flex gap-2" onsubmit={(event) => { event.preventDefault(); create() }}>
      <label class="min-w-0 flex-1">
        <span class="sr-only">New list name</span>
        <input data-focusable bind:value={newListName} maxlength="60" placeholder="Create a new list…"
          class="h-12 w-full rounded-xl bg-white/10 px-4 text-base text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-white" />
      </label>
      <button type="submit" data-focusable disabled={!newListName.trim()}
        class="flex h-12 items-center gap-1.5 rounded-xl bg-white/10 px-4 text-base font-bold text-white hover:bg-white/20 focus-visible:bg-white focus-visible:text-black disabled:opacity-40">
        <Plus size={18} /> Add
      </button>
    </form>
  {/snippet}
</OptionsSheet>
