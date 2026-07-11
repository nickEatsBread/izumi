<script lang="ts">
  import { addonUrls, disabledSources, normalizeBase } from '$lib/stremio/sources'
  import { autoSelectSource, autoSelectAnimate, preferredQuality } from '$lib/settings/ui'
  import { fetchManifest } from '$lib/stremio/manifest'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import Globe from 'lucide-svelte/icons/globe'

  let input = $state('')
  function add() { const b = normalizeBase(input); if (b) { $addonUrls = [...$addonUrls, b]; input = '' } }
  function toggle(url: string) { $disabledSources = $disabledSources.includes(url) ? $disabledSources.filter((u) => u !== url) : [...$disabledSources, url] }
  function remove(i: number) { const url = $addonUrls[i]; $addonUrls = $addonUrls.filter((_, j) => j !== i); $disabledSources = $disabledSources.filter((u) => u !== url) }
  const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname } catch { return u } }
</script>

<div class="p-8">
  <h2 class="mb-1 text-xl font-black">Sources</h2>
  <p class="mb-4 text-sm text-muted-foreground">Stremio addons (Torrentio/Comet) backed by your debrid, and how sources are chosen.</p>

  <div class="mb-6 max-w-2xl space-y-3">
    <Toggle label="Auto-select best source" desc="Skip the picker and play the best cached match for your preferred quality — after a short countdown when the picker is shown." value={$autoSelectSource} onToggle={() => ($autoSelectSource = !$autoSelectSource)} />
    {#if $autoSelectSource}
      <Toggle label="Animate the auto-select countdown" desc="Show the filling progress bar while the best source is auto-selected. Off = pick instantly with no animation (also disabled when your system requests reduced motion)." value={$autoSelectAnimate} onToggle={() => ($autoSelectAnimate = !$autoSelectAnimate)} />
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Preferred quality</span>
        <select data-focusable bind:value={$preferredQuality} class="rounded-md bg-input px-3 py-2 text-sm">
          <option value="2160">4K</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="any">Any (highest available)</option>
        </select>
      </label>
    {/if}
  </div>

  <div class="max-w-2xl">
    <p class="mb-2 text-sm text-muted-foreground">Paste a debrid-configured addon manifest URL (e.g. your Torrentio/Comet Real-Debrid link).</p>
    <div class="flex gap-2">
      <input bind:value={input} data-focusable placeholder="https://…/manifest.json" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
      <button onclick={add} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Add</button>
    </div>
    <ul class="mt-3 space-y-2">
      {#each $addonUrls as url, i (url)}
        {@const off = $disabledSources.includes(url)}
        <li class="flex items-center gap-3 rounded-lg border border-border p-3" class:opacity-50={off}>
          {#await fetchManifest(url)}
            <div class="skeloader size-10 shrink-0 rounded-md"></div>
            <div class="min-w-0 flex-1"><div class="skeloader h-4 w-1/3 rounded"></div></div>
          {:then m}
            {#if m?.logo}
              <img src={m.logo} alt="" class="size-10 shrink-0 rounded-md bg-neutral-900 object-contain" />
            {:else}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Globe size={18} /></div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-bold">{m?.name ?? host(url)}</span>
                {#if m?.version}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">v{m.version}</span>{/if}
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m?.description ?? url}</p>
            </div>
          {/await}
          <button data-focusable onclick={() => toggle(url)} aria-pressed={!off} title={off ? 'Enable' : 'Disable'}
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {off ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
            <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform {off ? 'translate-x-0.5' : 'translate-x-4'}"></span>
          </button>
          <button onclick={() => remove(i)} data-focusable class="shrink-0 text-sm text-destructive">Remove</button>
        </li>
      {/each}
      {#if !$addonUrls.length}<li class="text-sm text-muted-foreground">No sources yet.</li>{/if}
    </ul>
  </div>
</div>
