<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { nuvioCloud, sameCloudValue, type CloudProfile, type CloudAddon } from '$lib/nuvio/cloud'
  import { localCloudAddons, importCloudAddons } from '$lib/nuvio/transfer'
  import { normalizeBase } from '$lib/stremio/sources'
  import { fetchManifest } from '$lib/stremio/manifest'
  let { profile }: { profile: CloudProfile } = $props()
  let baseline = $state.raw<CloudAddon[]>([]), rows = $state<CloudAddon[]>([])
  let loading = $state(true), busy = $state(false), error = $state(''), notice = $state(''), url = $state('')
  const id = $derived(profile.uses_primary_addons ? 1 : profile.profile_index)
  const changed = $derived(!sameCloudValue(rows, baseline))
  const abort = new AbortController()
  const host = (url: string) => { try { return new URL(url).hostname } catch { return 'Source' } }
  onMount(() => { void load() }); onDestroy(() => abort.abort())
  async function run(action: () => Promise<void>) { busy = true; error = ''; notice = ''; try { await action() } catch (reason) { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Could not update sources.' } finally { if (!abort.signal.aborted) busy = false } }
  async function load() { loading = true; await run(async () => { const values = await nuvioCloud.addons(id, abort.signal); if (!abort.signal.aborted) { baseline = values; rows = structuredClone(values) } }); if (!abort.signal.aborted) loading = false }
  async function add() {
    await run(async () => {
      const base = normalizeBase(url)
      if (!base) throw new Error('Enter a Stremio manifest URL.')
      const manifest = await fetchManifest(base)
      if (abort.signal.aborted) return
      if (!manifest || typeof manifest.id !== 'string' || !manifest.id || typeof manifest.name !== 'string' || !manifest.name) throw new Error('This source did not return a valid Stremio manifest.')
      if (rows.some((row) => normalizeBase(row.url) === base)) throw new Error('This source is already in the list.')
      const parsed = new URL(base); parsed.pathname = parsed.pathname.replace(/\/$/, '') + '/manifest.json'
      rows = [...rows, { url: parsed.toString(), name: manifest.name, enabled: true }]; url = ''
    })
  }
  function stageLocal() { const existing = new Set(rows.map((row) => normalizeBase(row.url))); rows = [...rows, ...localCloudAddons().filter((row) => !existing.has(normalizeBase(row.url)))]; notice = 'Local sources added to the draft. Review the list, then save to Nuvio.' }
  function move(index: number, direction: number) { const next = [...rows]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; rows = next }
</script>

<div class="nv-toolbar"><div><h3 class="text-lg font-extrabold">Sources</h3><p class="nv-help mt-1">{profile.uses_primary_addons ? 'This profile shares profile 1’s sources. Changes apply to all profiles using that list.' : 'Manage the sources installed in this Nuvio profile.'}</p></div><button data-focusable class="nv-btn" disabled={busy} onclick={load}>Reload sources</button></div>
{#if error}<p class="nv-error" role="alert">{error}</p>{/if}{#if notice}<p class="nv-notice" role="status">{notice}</p>{/if}
{#if loading}<p class="nv-empty" role="status">Loading sources…</p>{:else}
  <fieldset disabled={busy}>
    <div class="mb-5 flex flex-wrap gap-2"><button data-focusable class="nv-btn" onclick={stageLocal}>Add izumi sources to draft</button><button data-focusable class="nv-btn" disabled={!rows.some((row) => row.enabled !== false)} onclick={() => run(async () => { const count = await importCloudAddons($state.snapshot(rows), abort.signal); if (!abort.signal.aborted) notice = `${count} enabled sources added to izumi.` })}>Add enabled sources to izumi</button></div>
    <p class="nv-help mb-4 text-xs">Transfers include each source’s configured URL. Review enabled sources before adding them.</p>
    {#each rows as row, index}
      <div class="nv-row flex-wrap sm:flex-nowrap"><label class="flex min-w-0 flex-1 items-center gap-3"><input data-focusable aria-label={`Enable ${row.name || host(row.url)}`} type="checkbox" checked={row.enabled !== false} onchange={(event) => row.enabled = event.currentTarget.checked} /><span class="min-w-0"><span class="block truncate text-sm font-bold">{row.name || host(row.url)}</span><span class="nv-help block truncate text-xs">{host(row.url)}</span></span></label><div class="flex gap-1"><button data-focusable class="nv-btn px-3" aria-label={`Move ${row.name || host(row.url)} up`} disabled={index === 0} onclick={() => move(index, -1)}>↑</button><button data-focusable class="nv-btn px-3" aria-label={`Move ${row.name || host(row.url)} down`} disabled={index === rows.length - 1} onclick={() => move(index, 1)}>↓</button><button data-focusable class="nv-btn" onclick={() => rows = rows.filter((_, at) => at !== index)}>Remove</button></div></div>
    {/each}
    {#if !rows.length}<p class="nv-empty">No sources yet. Add a manifest URL below or bring over your izumi sources.</p>{/if}
    <form class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={(event) => { event.preventDefault(); void add() }}><label class="nv-label flex-1">Add a source<input class="nv-input" required placeholder="https://…/manifest.json" bind:value={url} /></label><button data-focusable class="nv-btn">Add to draft</button></form>
    <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5"><button data-focusable class="nv-btn nv-primary" disabled={!changed} onclick={() => run(async () => { await nuvioCloud.saveAddons(id, $state.snapshot(rows), baseline, abort.signal); if (!abort.signal.aborted) { await load(); notice = 'Sources saved to Nuvio.' } })}>{busy ? 'Saving…' : 'Save sources to Nuvio'}</button>{#if changed}<span class="nv-help">Unsaved changes · {rows.length} sources in this draft</span>{/if}</div>
  </fieldset>
{/if}
