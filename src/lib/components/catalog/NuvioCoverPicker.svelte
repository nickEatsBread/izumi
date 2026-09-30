<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioApi, type NuvioItem } from '$lib/nuvio/api'
  import NuvioArtwork from './NuvioArtwork.svelte'
  let { choose, close }: { choose: (url: string, portrait: boolean) => void; close: () => void } = $props()
  let search = $state(''), page = $state(1), more = $state(false), busy = $state(false), error = $state(''), items = $state.raw<NuvioItem[]>([])
  let abort: AbortController | undefined
  onMount(() => { void load() }); onDestroy(() => abort?.abort())
  async function load(next = 1) {
    abort?.abort(); const controller = abort = new AbortController(); busy = true; error = ''
    try { const result = await nuvioApi.browse('cover', { page: next, search, sort: 'popular', type: 'all', orientation: 'all', format: 'all' }, controller.signal); if (!controller.signal.aborted) { items = next === 1 ? result.items : [...items, ...result.items]; page = next; more = result.hasNext } }
    catch (reason) { if (!controller.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not load covers.' }
    finally { if (!controller.signal.aborted) busy = false }
  }
</script>
<section class="nv-panel mt-4" aria-label="Choose a Nuvio cover"><div class="nv-toolbar"><h4 class="font-bold">Choose artwork</h4><button type="button" data-focusable class="nv-btn" onclick={close}>Close artwork</button></div><div class="mb-4 flex gap-2"><input class="nv-input" aria-label="Find Nuvio artwork" placeholder="Search covers…" bind:value={search} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void load() } }} /><button type="button" data-focusable class="nv-btn" disabled={busy} onclick={() => load()}>Search</button></div>{#if error}<p class="nv-error" role="alert">{error}</p>{/if}<div data-nav-scroll-container class="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">{#each items as item}<button type="button" data-focusable class="min-w-0 text-left" disabled={!item.imageUrl} onclick={() => choose(item.imageUrl!, item.portrait)}><span class="block aspect-video overflow-hidden rounded-lg bg-secondary"><NuvioArtwork url={item.imageUrl} title={item.title} /></span><span class="mt-1 block truncate text-xs font-bold">{item.title}</span></button>{/each}</div>{#if busy}<p role="status" class="nv-help mt-3">Loading artwork…</p>{:else if more}<button type="button" data-focusable class="nv-btn mt-4" onclick={() => load(page + 1)}>More artwork</button>{:else if !items.length}<p class="nv-empty">No matching artwork.</p>{/if}</section>
