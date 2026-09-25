<script lang="ts">
  import { untrack } from 'svelte'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { allStores, directoryEnabled, pinStoreKey, removeStore, setStoreEnabled, type StoreFeed } from '$lib/store/feeds'
  import { confirmStore, previewStore, type StorePreview } from '$lib/store/service'
  import { storeTrustText } from '$lib/store/trust'
  import type { LoadedStore } from '$lib/store/load'
  import { ADDON_DIRECTORY_ID } from '$lib/store/types'

  let { mode = 'manage', initialUrl = '', loaded, onclose, onadded }: {
    mode?: 'manage' | 'add'
    initialUrl?: string
    loaded: Record<string, LoadedStore>
    onclose: () => void
    onadded: (id: string) => void
  } = $props()

  let view = $state(untrack(() => mode))
  let input = $state(untrack(() => initialUrl))
  let busy = $state(false)
  let error = $state('')
  let preview = $state<StorePreview | null>(null)
  /** The store whose Remove button was pressed once; a second press removes it. */
  let confirmRemove = $state('')

  function host(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  async function check() {
    if (busy) return
    busy = true
    error = ''
    preview = null
    try {
      preview = await previewStore(input)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The store could not be loaded.'
    } finally {
      busy = false
    }
  }

  function add() {
    if (!preview) return
    try {
      const feed = confirmStore(preview)
      onadded(feed.id)
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The store could not be added.'
    }
  }

  /** Accept a store's new key (or its decision to stop signing) after the user reviewed it. */
  function trust(store: StoreFeed) {
    const result = loaded[store.id]
    if (result?.trust.state !== 'locked') return
    try {
      pinStoreKey(store.id, result.trust.fingerprint)
    } catch (cause) {
      // A key izumi compiled in for a built-in store can't be replaced from here.
      error = cause instanceof Error ? cause.message : 'That key could not be trusted.'
    }
  }

</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !busy) onclose() }} />

<div class="fixed inset-0 z-[100] grid place-items-end bg-black/75 sm:place-items-center sm:p-4" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget && !busy) onclose() }}>
  <div role="dialog" aria-modal="true" aria-labelledby="stores-dialog-title" data-nav-trap data-nav-escape
       class="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-6">
    <h2 id="stores-dialog-title" class="text-lg font-black">Stores</h2>
    <div class="mb-4 mt-3 flex gap-2">
      <button type="button" data-focusable aria-pressed={view === 'manage'} onclick={() => (view = 'manage')}
              class="rounded-lg px-3 py-2 text-sm font-black {view === 'manage' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">Your stores</button>
      <button type="button" data-focusable aria-pressed={view === 'add'} onclick={() => (view = 'add')}
              class="rounded-lg px-3 py-2 text-sm font-black {view === 'add' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">Add a store</button>
    </div>

    {#if view === 'manage'}
      <ul class="space-y-2">
        {#each $allStores as store (store.id)}
          {@const result = loaded[store.id]}
          <li class="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3" class:opacity-60={!store.enabled}>
            <span class="min-w-0 flex-1 basis-40">
              <span class="block truncate text-sm font-black">{store.name}</span>
              <span class="block truncate text-xs text-muted-foreground">{store.builtin ? 'Built in' : host(store.url)} · {storeTrustText(result?.trust)}</span>
            </span>
            {#if result?.trust.state === 'locked' && result.trust.reason !== 'bad-signature'}
              <p class="basis-full text-xs text-destructive">
                {result.trust.reason === 'key-changed'
                  ? `It now signs with key ${result.trust.fingerprint?.slice(0, 16) ?? 'unknown'}. Trust it only if the store's owner announced a new key.`
                  : "It stopped signing its listing. Accept that only if the store's owner announced it."}
              </p>
              <button type="button" data-focusable onclick={() => trust(store)}
                      class="rounded-md bg-destructive/15 px-3 py-2 text-sm font-black text-destructive sm:py-1.5 sm:text-xs">
                {result.trust.reason === 'key-changed' ? 'Trust new key' : 'Trust without a key'}
              </button>
            {/if}
            <button type="button" data-focusable onclick={() => setStoreEnabled(store.id, !store.enabled)}
                    class="rounded-md px-3 py-2 text-sm font-black sm:py-1.5 sm:text-xs {store.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary'}">{store.enabled ? 'Shown' : 'Hidden'}</button>
            {#if !store.builtin}
              <!-- Two presses: the first only asks, so one stray tap never drops a store and its pin. -->
              <button type="button" data-focusable aria-label={confirmRemove === store.id ? `Confirm removing ${store.name}` : `Remove ${store.name}`}
                      onclick={() => { if (confirmRemove === store.id) { confirmRemove = ''; removeStore(store.id) } else confirmRemove = store.id }}
                      class="flex items-center gap-1 rounded-md p-2 text-sm font-black text-destructive active:bg-destructive/10"><Trash2 size={16} />{#if confirmRemove === store.id}Remove?{/if}</button>
            {/if}
          </li>
        {/each}
        <li class="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3" class:opacity-60={!$directoryEnabled}>
          <span class="min-w-0 flex-1 basis-40">
            <span class="block truncate text-sm font-black">Addon directory</span>
            <span class="block truncate text-xs text-muted-foreground">Built in · community Stremio addons, searched online</span>
          </span>
          <button type="button" data-focusable onclick={() => setStoreEnabled(ADDON_DIRECTORY_ID, !$directoryEnabled)}
                  class="rounded-md px-3 py-2 text-sm font-black sm:py-1.5 sm:text-xs {$directoryEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary'}">{$directoryEnabled ? 'Shown' : 'Hidden'}</button>
        </li>
      </ul>
    {:else}
      <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(event) => { event.preventDefault(); void check() }}>
        <input bind:value={input} data-focusable aria-label="Store link" placeholder="https://… or owner/repo"
               class="min-w-0 flex-1 rounded-md bg-input px-3 py-2.5 text-base sm:text-sm" />
        <button type="submit" data-focusable disabled={busy || !input.trim()}
                class="flex items-center justify-center gap-1 rounded-md bg-secondary px-4 py-2.5 text-sm font-black disabled:opacity-40">
          {#if busy}<RefreshCw size={14} class="animate-spin" />{/if} Check
        </button>
      </form>
      {#if preview}
        <div class="mt-4 rounded-lg border border-border p-3">
          <p class="font-black">{preview.name}</p>
          <p class="text-xs text-muted-foreground">{preview.domain} · {preview.signed ? `Signed · key ${preview.fingerprint?.slice(0, 16)}` : 'Unsigned'}</p>
          <ul class="mt-2 text-sm">
            {#each preview.counts as [label, count] (label)}<li>{count} × {label}</li>{/each}
            {#if !preview.counts.length}<li class="text-muted-foreground">Nothing this version of izumi can install yet.</li>{/if}
          </ul>
          {#if preview.skipped}<p class="mt-2 text-xs text-muted-foreground">{preview.skipped} entries couldn't be read and are skipped.</p>{/if}
          <p class="mt-3 text-xs text-amber-400">Third-party store: izumi doesn't review it. Adding it installs nothing.</p>
          <button type="button" data-focusable onclick={add} class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground">Add store</button>
        </div>
      {/if}
    {/if}
    {#if error}<p role="alert" class="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>{/if}
    <div class="mt-5 flex justify-end">
      <button type="button" data-focusable disabled={busy} onclick={onclose} class="rounded-md px-3 py-2 text-sm font-bold text-muted-foreground">Close</button>
    </div>
  </div>
</div>
