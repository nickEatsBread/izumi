<script lang="ts">
  import { debridProvider, debridKey } from '$lib/settings/ui'
  import { supportsListing, listItems, deleteItem, providerName } from '$lib/stremio/debrid'
  import { openItem } from '$lib/stremio/debrid/cloud'
  import FileBrowser from '$lib/components/cloud/FileBrowser.svelte'
  import { heroMedia } from '$lib/stores/hero'
  import type { DebridItem } from '$lib/stremio/debrid/types'
  import Search from 'lucide-svelte/icons/search'
  import Play from 'lucide-svelte/icons/play'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import RotateCw from 'lucide-svelte/icons/rotate-cw'

  heroMedia.set(null)

  let items = $state<DebridItem[]>([])
  let loading = $state(true)
  let error = $state('')
  let filter = $state('')
  let confirmId = $state('')           // row awaiting a second Delete click
  let notice = $state('')              // transient play/error notice

  const prov = $derived($debridProvider)
  const supported = $derived(supportsListing(prov))
  const list = $derived(items.filter((i) => !filter.trim() || i.name.toLowerCase().includes(filter.trim().toLowerCase())).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)))
  const totalBytes = $derived(items.reduce((s, i) => s + (i.size || 0), 0))

  const fmtBytes = (n?: number) => {
    if (!n) return '0 MB'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
  }

  async function load() {
    loading = true; error = ''
    try {
      if (!$debridKey) { error = `Add a ${providerName(prov)} key in Settings → Extensions to browse your account.`; items = []; return }
      if (!supported) { error = `${providerName(prov)} doesn't support browsing your account.`; items = []; return }
      items = await listItems(prov, $debridKey)
    }
    catch (e) { error = e instanceof Error ? e.message : String(e) }
    finally { loading = false }
  }

  function play(i: DebridItem) {
    if (i.status !== 'ready') return
    openItem(i, (s) => { notice = s.status === 'error' ? (s.message ?? 'Playback failed.') : '' })
  }

  async function remove(i: DebridItem) {
    if (confirmId !== i.id) { confirmId = i.id; return }
    confirmId = ''
    try { await deleteItem(prov, $debridKey, i); items = items.filter((x) => x.id !== i.id) }
    catch (e) { notice = e instanceof Error ? e.message : String(e) }
  }

  // Reload whenever the active provider changes.
  $effect(() => { void prov; load() })
</script>

<div class="p-8">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-black">Cloud</h1>
    <div class="flex items-center gap-3">
      <span class="text-sm text-muted-foreground">{providerName(prov)} · {items.length} items · {fmtBytes(totalBytes)}</span>
      <button data-focusable title="Refresh" onclick={load} class="grid size-8 place-items-center rounded-md hover:bg-accent"><RotateCw size={15} /></button>
      <label class="flex items-center gap-2 rounded-lg bg-secondary px-3 py-1.5">
        <Search size={15} class="text-muted-foreground" />
        <input bind:value={filter} data-focusable placeholder="Filter…" class="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
    </div>
  </div>

  {#if notice}<p class="mb-3 text-sm text-destructive">{notice}</p>{/if}

  {#if loading}
    <p class="mt-16 text-center text-muted-foreground">Loading your {providerName(prov)} account…</p>
  {:else if error}
    <p class="mt-16 text-center text-muted-foreground">{error}</p>
  {:else if !list.length}
    <p class="mt-16 text-center text-muted-foreground">Nothing on your {providerName(prov)} account yet.</p>
  {:else}
    <div class="max-w-3xl space-y-2">
      {#each list as i (i.id)}
        <div class="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold">{i.name}</div>
            {#if i.status === 'ready'}
              <div class="mt-0.5 text-[0.7rem] text-muted-foreground">{fmtBytes(i.size)}{i.fileCount ? ` · ${i.fileCount} files` : ''}</div>
            {:else if i.status === 'downloading'}
              <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div class="h-full bg-blue-400 transition-[width] duration-300 ease-out" style="width:{Math.round(i.progress ?? 0)}%"></div>
              </div>
              <div class="mt-1 text-[0.7rem] text-muted-foreground">{Math.round(i.progress ?? 0)}% · caching…</div>
            {:else if i.status === 'error'}
              <div class="mt-0.5 text-[0.7rem] text-destructive">Unavailable</div>
            {:else}
              <div class="mt-0.5 text-[0.7rem] text-muted-foreground">Queued…</div>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-1">
            {#if i.status === 'ready'}
              <button data-focusable title="Play" onclick={() => play(i)} class="grid size-8 place-items-center rounded-md hover:bg-accent"><Play size={16} /></button>
            {/if}
            <button data-focusable title={confirmId === i.id ? 'Click again to confirm' : 'Remove from account'} onclick={() => remove(i)} class="grid size-8 place-items-center rounded-md hover:bg-accent {confirmId === i.id ? 'text-destructive' : ''}"><Trash2 size={16} /></button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<FileBrowser />
