<script lang="ts">
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Star from '@lucide/svelte/icons/star'
  import { entryTypeLabel } from '$lib/store/filters'
  import type { StoreEntry } from '$lib/store/types'

  let { entry, storeName, thirdParty, installed, update, busy, locked, onopen, oninstall }: {
    entry: StoreEntry
    storeName: string
    thirdParty: boolean
    installed: boolean
    /** Installed, and this store lists a newer version the entry may update to. */
    update: boolean
    busy: boolean
    /** The entry's store failed its key check: browsing works, installing doesn't. */
    locked: boolean
    onopen: () => void
    oninstall: () => void
  } = $props()

  const action = $derived(entry.install.type === 'theme'
    ? 'Preview'
    : entry.install.type === 'addon' && entry.install.configureUrl ? 'Configure' : 'Install')
</script>

<article class="flex w-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl border border-border bg-secondary/25 p-4 lg:items-center lg:p-3">
  <button type="button" data-focusable onclick={onopen} class="flex min-w-0 flex-1 items-start gap-3 text-left lg:items-center">
    <AddonLogo logo={entry.icon} name={entry.name} id={entry.id} size={44} />
    <span class="min-w-0 flex-1">
      <span class="flex items-start gap-2">
        <span class="min-w-0 flex-1 truncate font-black">{entry.name}</span>
        {#if entry.popularity != null}
          <span class="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-400"><Star size={12} fill="currentColor" />{entry.popularity}</span>
        {/if}
      </span>
      <span class="mt-0.5 block truncate text-xs text-muted-foreground">
        {entryTypeLabel(entry)}{#if entry.version} · v{entry.version}{/if}{#if entry.languages.length} · {entry.languages.join(', ').toUpperCase()}{/if}
      </span>
      <span class="mt-1 flex flex-wrap gap-1 text-[0.68rem] font-bold">
        {#if thirdParty}<span class="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">{storeName}</span>{/if}
        {#if entry.nsfw}<span class="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">18+</span>{/if}
        {#if entry.requiresDebrid}<span class="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">Needs debrid</span>{/if}
      </span>
    </span>
  </button>
  <div class="flex shrink-0 items-center">
    {#if installed && !update}
      <span class="rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-black text-emerald-400 sm:py-1.5 sm:text-xs">Installed</span>
    {:else}
      <button type="button" data-focusable disabled={busy || locked} onclick={oninstall}
              class="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-black text-primary-foreground disabled:opacity-40 sm:py-1.5 sm:text-xs">
        {#if busy}<RefreshCw size={12} class="animate-spin" />{/if}{installed ? 'Update' : action}
      </button>
    {/if}
  </div>
</article>
