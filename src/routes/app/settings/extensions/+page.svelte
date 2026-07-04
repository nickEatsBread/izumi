<script lang="ts">
  import { debridKey, debridProvider, extensionUrls } from '$lib/settings/ui'
  import { fetchExtensionMeta } from '$lib/extensions/manager'
  import { providerList, providerMeta } from '$lib/stremio/debrid'
  import Puzzle from 'lucide-svelte/icons/puzzle'
  import Trash2 from 'lucide-svelte/icons/trash-2'

  const current = $derived(providerMeta($debridProvider))

  let extInput = $state('')
  function addExt() { const u = extInput.trim(); if (u) { $extensionUrls = [...$extensionUrls, u]; extInput = '' } }
  function removeExt(i: number) { $extensionUrls = $extensionUrls.filter((_, j) => j !== i) }
  const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname } catch { return u } }
  const iconSrc = (l: string) => l.startsWith('http') || l.startsWith('data:image') ? l : `data:image/png;base64,${l}`
  // A GitHub spec (gh:owner/repo or bare owner/repo/sub) — shown with a GitHub icon +
  // the repo path as the title.
  const isGh = (u: string) => u.startsWith('gh:') || (/^[A-Za-z0-9][A-Za-z0-9-]*\/[^\s:]+$/.test(u) && !/^https?:/.test(u))
  const cleanSpec = (u: string) => u.replace(/^gh:/, '')
</script>

<div class="p-8">
  <h2 class="mb-1 text-xl font-black">Extensions</h2>
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">
    Community source extensions, resolved through your chosen debrid service (no torrent client). Their results appear in the source picker alongside your addons (marked uncached until the debrid resolves them).
    <span class="text-amber-400">Experimental — extensions run as untrusted third-party code in an isolated worker. Only add manifests you trust.</span>
  </p>

  <div class="max-w-2xl">
    <label class="mb-4 flex flex-col gap-1">
      <span class="text-sm font-bold">Debrid service</span>
      <select data-focusable bind:value={$debridProvider} class="rounded-md bg-input px-3 py-2 text-sm">
        {#each providerList as p (p.id)}
          <option value={p.id}>{p.name}{p.experimental ? ' (experimental)' : ''}</option>
        {/each}
      </select>
    </label>

    <label class="mb-6 flex flex-col gap-1">
      <span class="text-sm font-bold">{current?.name ?? 'Debrid'} {current?.credential === 'userpass' ? 'login' : 'API key'}</span>
      <input type="password" bind:value={$debridKey} data-focusable placeholder={current?.credential === 'userpass' ? 'username:password' : `Your ${current?.name ?? 'debrid'} token`} class="rounded-md bg-input px-3 py-2 text-sm" />
      <span class="text-xs text-muted-foreground">From {current?.keyHint ?? 'your debrid account'}. Turns extension torrent results into cached streams.</span>
    </label>

    <p class="mb-2 text-sm text-muted-foreground">Extension sources — a GitHub repo (<code class="rounded bg-secondary px-1 text-xs">gh:owner/repo</code> or <code class="rounded bg-secondary px-1 text-xs">owner/repo/folder</code>) or a manifest URL.</p>
    <div class="flex gap-2">
      <input bind:value={extInput} data-focusable placeholder="gh:owner/anime-extensions  ·  or  https://…/manifest.json" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" onkeydown={(e) => e.key === 'Enter' && addExt()} />
      <button onclick={addExt} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Add</button>
    </div>
    <ul class="mt-3 space-y-2">
      {#each $extensionUrls as url, i (url)}
        {@const ext = fetchExtensionMeta(url)}
        {@const gh = isGh(url)}
        <li class="flex items-center gap-3 rounded-lg border border-border p-3">
          {#await ext}
            <div class="skeloader size-10 shrink-0 rounded-md"></div>
            <div class="min-w-0 flex-1"><div class="skeloader h-4 w-1/3 rounded"></div></div>
          {:then metas}
            {@const m = metas[0]}
            {#if gh}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-foreground">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.61 8.2 11.17.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.7-4.04-1.58-4.04-1.58-.55-1.36-1.33-1.73-1.33-1.73-1.09-.73.08-.71.08-.71 1.2.08 1.83 1.21 1.83 1.21 1.07 1.79 2.81 1.27 3.5.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.29-5.47-5.75 0-1.27.47-2.31 1.24-3.12-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.19a11.6 11.6 0 0 1 3-.39c1.02 0 2.05.13 3 .39 2.29-1.51 3.3-1.19 3.3-1.19.66 1.64.24 2.86.12 3.16.77.81 1.24 1.85 1.24 3.12 0 4.47-2.81 5.45-5.49 5.74.43.36.81 1.08.81 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.22.68.83.56A12.02 12.02 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z"/></svg>
              </div>
            {:else if m?.icon}
              <img src={iconSrc(m.icon)} alt="" class="size-10 shrink-0 rounded-md bg-neutral-900 object-contain" />
            {:else}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Puzzle size={18} /></div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-bold">{gh || metas.length > 1 ? cleanSpec(url) : (m?.name ?? host(url))}</span>
                {#if metas.length}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">{metas.length} {metas.length === 1 ? 'Extension' : 'Extensions'}</span>{/if}
                {#if m?.version && metas.length === 1}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">v{m.version}</span>{/if}
              </div>
              {#if metas.length > 1}
                <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{metas.map((x) => x.name).join(' · ')}</p>
              {:else}
                <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m?.description ?? (gh ? url : host(url))}</p>
              {/if}
            </div>
          {/await}
          <button onclick={() => removeExt(i)} data-focusable title="Remove" class="grid size-8 shrink-0 place-items-center rounded-md text-destructive hover:bg-accent"><Trash2 size={16} /></button>
        </li>
      {/each}
      {#if !$extensionUrls.length}<li class="text-sm text-muted-foreground">No extensions added.</li>{/if}
    </ul>
  </div>
</div>
