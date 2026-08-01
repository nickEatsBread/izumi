<script lang="ts">
  import { addonUrls, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { autoSelectSource, autoSelectCountdown, preferredQuality, seadexAnnotations } from '$lib/settings/ui'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { findAddonConfigureUrl } from '$lib/stremio/configure'
  import { defaultDiscussionPlatform } from '$lib/comments'
  import AddonConfigurator from '$lib/components/settings/AddonConfigurator.svelte'
  import Globe from 'lucide-svelte/icons/globe'
  import Store from 'lucide-svelte/icons/store'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  // One control over two stores: whether to auto-pick at all, and whether to wait first. They were
  // separate toggles, which read as unrelated settings even though the second only means anything
  // when the first is on.
  const autoMode = $derived(!$autoSelectSource ? 'off' : $autoSelectCountdown ? 'countdown' : 'instant')
  function setAutoMode(mode: string) {
    $autoSelectSource = mode !== 'off'
    if (mode !== 'off') $autoSelectCountdown = mode === 'countdown'
  }

  let input = $state('')
  let addError = $state('')
  let configuring = $state<{
    name: string
    id: string
    configureUrl: string
    currentBase: string
  } | null>(null)
  function add() {
    const base = normalizeBase(input)
    if (!base) {
      addError = 'Enter a valid add-on manifest URL.'
      return
    }
    addError = ''
    if (!$addonUrls.some((url) => normalizeBase(url) === base)) $addonUrls = [...$addonUrls, base]
    $disabledSources = $disabledSources.filter((url) => normalizeBase(url) !== base)
    input = ''
  }
  function toggle(url: string) { $disabledSources = $disabledSources.includes(url) ? $disabledSources.filter((u) => u !== url) : [...$disabledSources, url] }
  function remove(i: number) { const url = $addonUrls[i]; $addonUrls = $addonUrls.filter((_, j) => j !== i); $disabledSources = $disabledSources.filter((u) => u !== url) }
  function beginConfiguration(currentBase: string, name: string, id: string, configureUrl: string) {
    configuring = { currentBase, name, id, configureUrl }
  }
  function saveConfiguration(base: string) {
    if (!configuring) return
    $addonUrls = replaceAddonBase($addonUrls, configuring.currentBase, base)
    $disabledSources = $disabledSources.filter((url) =>
      url !== configuring?.currentBase && normalizeBase(url) !== normalizeBase(base))
    configuring = null
  }
  const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname } catch { return u } }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Sources</h2>
  <p class="mb-4 text-sm text-muted-foreground">Stremio addons backed by your debrid, and how sources are chosen.</p>
  <a href="/app/settings/store" data-focusable
     class="mb-6 inline-flex items-center gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm font-black transition-colors hover:bg-accent">
    <Store size={16} />
    Open Source Store
  </a>

  <div class="mb-6 max-w-2xl space-y-3">
    <label data-setting-key="auto-play-the-best-source" class="flex flex-col gap-1">
      <span class="text-sm font-bold">Auto-play the best source</span>
      <SelectMenu
        value={autoMode}
        onChange={setAutoMode}
        ariaLabel="Auto-play the best source"
        options={[
          { value: 'countdown', label: 'After a ~5s countdown' },
          { value: 'instant', label: 'Immediately' },
          { value: 'off', label: 'Off — always choose manually' },
        ]}
      />
      <span class="text-xs text-muted-foreground">
        {#if autoMode === 'off'}The source list stays open until you pick one yourself.
        {:else if autoMode === 'instant'}The best cached match for your preferred quality plays the moment the source list settles — no wait, no chance to cancel.
        {:else}Once the source list settles, the Auto button fills left→right for ~5 seconds, then the best cached match for your preferred quality plays. Cancel any time by picking another source or interacting.{/if}
      </span>
    </label>

    {#if $autoSelectSource}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Preferred quality</span>
        <SelectMenu
          bind:value={$preferredQuality}
          ariaLabel="Preferred quality"
          options={[
            { value: '2160', label: '4K' },
            { value: '1080', label: '1080p' },
            { value: '720', label: '720p' },
            { value: '480', label: '480p' },
            { value: 'any', label: 'Any (highest available)' },
          ]}
        />
      </label>
    {/if}

    <Toggle
      label="Mark best releases"
      desc="Check releases.moe for the release its curators rate best for each title, badge it in the source list, and prefer it within your chosen quality. Adds no source — it only annotates what your addons already found."
      value={$seadexAnnotations}
      onToggle={() => ($seadexAnnotations = !$seadexAnnotations)}
    />
  </div>

  <div class="max-w-2xl">
    <p class="mb-2 text-sm text-muted-foreground">Paste a debrid-configured addon manifest URL.</p>
    <div class="flex gap-2">
      <input bind:value={input} data-focusable placeholder="https://…/manifest.json" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" onkeydown={(event) => { if (event.key === 'Enter') add() }} />
      <button onclick={add} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Add</button>
    </div>
    {#if addError}<p role="alert" class="mt-2 text-xs text-destructive">{addError}</p>{/if}
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
            {#if m}
              {#await findAddonConfigureUrl(url, m) then configureUrl}
                {#if configureUrl}
                  <button data-focusable onclick={() => beginConfiguration(url, m.name, m.id, configureUrl)}
                          class="shrink-0 rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent">Configure</button>
                {/if}
              {/await}
            {/if}
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

  <div class="mt-8 max-w-2xl">
    <h3 class="mb-1 text-sm font-black">Discussion</h3>
    <p class="mb-3 text-xs text-muted-foreground">A comment button in the player shows episode discussions from the available community sources.</p>
    <label data-setting-key="default-discussion-source" class="flex flex-col gap-1">
      <span class="text-sm font-bold">Default source</span>
      <span class="text-xs text-muted-foreground">Which source the discussion panel opens on. An embeddable source (Disqus/forum) renders its embed inline.</span>
      <SelectMenu
        bind:value={$defaultDiscussionPlatform}
        className="mt-1"
        ariaLabel="Default discussion source"
        options={[
          { value: 'disqus', label: 'Disqus' },
          { value: 'auto', label: 'Auto — all sources' },
          { value: 'reddit', label: 'Reddit' },
          { value: 'anilist', label: 'AniList' },
          { value: 'mal', label: 'MyAnimeList' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'animecommunity', label: 'Anime Community' },
        ]}
      />
    </label>
  </div>
</div>

{#if configuring}
  <AddonConfigurator
    name={configuring.name}
    expectedId={configuring.id}
    configureUrl={configuring.configureUrl}
    onCancel={() => (configuring = null)}
    onConfigured={saveConfiguration}
  />
{/if}
