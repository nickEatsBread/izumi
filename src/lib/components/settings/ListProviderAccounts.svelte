<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ListPlus from '@lucide/svelte/icons/list-plus'
  import Plus from '@lucide/svelte/icons/plus'
  import X from '@lucide/svelte/icons/x'
  import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
  import { hideHomeRow, insertHomeRow } from '$lib/catalog/home-editor'
  import {
    stremioHomeRowOptionsForSources,
    supportsStremioCatalogManifest,
    type StremioCatalogSource,
  } from '$lib/catalog/providers/stremio'
  import type { CatalogHomeRowOption } from '$lib/catalog/types'
  import { catalogProvider, catalogProviders, normalizeCatalogProviders } from '$lib/settings/catalog'
  import { fetchManifest, type AddonManifest } from '$lib/stremio/manifest'
  import {
    LIST_PROVIDERS,
    listProviderOwnsUrl,
    type ListProvider,
    type ListProviderId,
  } from '$lib/stremio/list-providers'
  import {
    addonOriginId,
    addonUrls,
    disabledSources,
    normalizeBase,
    replaceAddonBase,
  } from '$lib/stremio/sources'
  import AddonConfigurator from './AddonConfigurator.svelte'
  import SettingsGroup from './SettingsGroup.svelte'
  import SettingsRow from './SettingsRow.svelte'

  type ProviderConnection = {
    base: string
    manifest?: AddonManifest
  }

  const manifestRequests = $derived($addonUrls.map((base) => ({ base, request: fetchManifest(base) })))
  let loadedSources = $state<StremioCatalogSource[]>([])
  let manifestsReady = $state(false)
  let openProvider = $state<ListProviderId | null>(null)
  let configuring = $state<ListProvider | null>(null)

  $effect(() => {
    const pending = manifestRequests
    let stale = false
    manifestsReady = pending.length === 0
    loadedSources = []
    if (!pending.length) return
    void Promise.all(pending.map(async ({ base, request }) => ({ base, manifest: await request })))
      .then((sources) => {
        if (stale) return
        loadedSources = sources.flatMap(({ base, manifest }) =>
          manifest ? [{ base: normalizeBase(base), manifest }] : [])
        manifestsReady = true
      })
    return () => { stale = true }
  })

  const connections = $derived.by(() => {
    const next = new Map<ListProviderId, ProviderConnection>()
    for (const provider of LIST_PROVIDERS) {
      const loaded = loadedSources.find((source) => source.manifest.id === provider.addonId)
      const provisional = $addonUrls.find((url) => listProviderOwnsUrl(provider, normalizeBase(url)))
      if (loaded) next.set(provider.id, loaded)
      else if (provisional) next.set(provider.id, { base: normalizeBase(provisional) })
    }
    return next
  })
  const catalogSources = $derived(loadedSources.filter((source) =>
    supportsStremioCatalogManifest(source.manifest)))
  const homeOptions = $derived(stremioHomeRowOptionsForSources(catalogSources))
  const homeRows = $derived(resolveCatalogHomeRows('stremio', homeOptions, $catalogHomeLayouts))
  const connectedCount = $derived(connections.size)

  function connectionFor(provider: ListProvider): ProviderConnection | undefined {
    return connections.get(provider.id)
  }

  function rowsFor(connection: ProviderConnection | undefined): Array<CatalogHomeRowOption & { enabled: boolean }> {
    if (!connection?.manifest) return []
    const prefix = `${addonOriginId(connection.base)}:`
    return homeRows.filter((row) => row.id.startsWith(prefix))
  }

  function enableCatalogPlatform(): void {
    const providers = normalizeCatalogProviders($catalogProviders, $catalogProvider)
    if (!providers.includes('stremio')) $catalogProviders = [...providers, 'stremio']
  }

  function saveConfiguration(provider: ListProvider, base: string): void {
    const connection = connectionFor(provider)
    const previous = connection?.base
      ?? $addonUrls.find((url) => listProviderOwnsUrl(provider, normalizeBase(url)))
    const normalized = normalizeBase(base)
    $addonUrls = replaceAddonBase($addonUrls, previous, normalized)
    $disabledSources = $disabledSources.filter((url) =>
      url !== previous && normalizeBase(url) !== normalized)
    enableCatalogPlatform()
    openProvider = provider.id
    configuring = null
  }

  function disconnect(provider: ListProvider): void {
    const owned = new Set(loadedSources
      .filter((source) => source.manifest.id === provider.addonId)
      .map((source) => source.base))
    const removed = $addonUrls.filter((url) =>
      owned.has(normalizeBase(url)) || listProviderOwnsUrl(provider, normalizeBase(url)))
    $addonUrls = $addonUrls.filter((url) => !removed.includes(url))
    $disabledSources = $disabledSources.filter((url) => !removed.includes(url))
    if (openProvider === provider.id) openProvider = null
  }

  function enableConnection(connection: ProviderConnection): void {
    $disabledSources = $disabledSources.filter((url) =>
      url !== connection.base && normalizeBase(url) !== connection.base)
  }

  function addToHome(row: CatalogHomeRowOption & { enabled: boolean }): void {
    enableCatalogPlatform()
    insertHomeRow('stremio', homeRows, row.id, null)
  }

  function removeFromHome(rowId: string): void {
    hideHomeRow('stremio', homeRows.filter((row) => row.enabled).map((row) => row.id), rowId)
  }
</script>

<SettingsGroup
  icon={ListPlus}
  title="List providers"
  desc={`${connectedCount} of ${LIST_PROVIDERS.length} connected. Add each watchlist, recommendation feed, or custom list to Home separately.`}
>
  {#each LIST_PROVIDERS as provider (provider.id)}
    {@const connection = connectionFor(provider)}
    {@const rows = rowsFor(connection)}
    {@const disabled = Boolean(connection && $disabledSources.some((url) => normalizeBase(url) === connection.base))}
    {#snippet providerBadge()}
      <span class="grid size-10 shrink-0 place-items-center rounded-xl font-black {provider.accent}" aria-hidden="true">
        <span class={provider.initials.length > 1 ? 'text-[9px]' : 'text-sm'}>{provider.initials}</span>
      </span>
    {/snippet}
    {#snippet providerMeta()}
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <span class="size-1.5 shrink-0 rounded-full {connection ? disabled ? 'bg-amber-400' : 'bg-emerald-400' : 'bg-white/25'}"></span>
        <span class="truncate">
          {#if connection?.manifest}
            Connected · {rows.length} Home element{rows.length === 1 ? '' : 's'} available{disabled ? ' · disabled' : ''}
          {:else if connection}
            {manifestsReady ? 'Connected · manifest unavailable' : 'Checking connection…'}
          {:else}
            Not connected · provider sign-in
          {/if}
        </span>
      </span>
    {/snippet}
    {#snippet providerControl()}
      {#if connection}
        <button
          type="button"
          data-focusable
          aria-expanded={openProvider === provider.id}
          onclick={() => (openProvider = openProvider === provider.id ? null : provider.id)}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-xs font-bold transition-colors hover:bg-accent"
        >
          Lists <ChevronDown size={14} class="transition-transform {openProvider === provider.id ? 'rotate-180' : ''}" />
        </button>
      {:else}
        <button
          type="button"
          data-focusable
          onclick={() => (configuring = provider)}
          class="min-h-8 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground"
        >Connect</button>
      {/if}
    {/snippet}

    <SettingsRow
      settingKey={`${provider.id}-account`}
      title={provider.name}
      description={provider.description}
      leading={providerBadge}
      meta={providerMeta}
      control={providerControl}
      expanded={openProvider === provider.id}
    >
      {#if disabled && connection}
        <div class="mb-3 flex items-center justify-between gap-3 rounded-lg bg-amber-500/10 px-3 py-2">
          <p class="text-xs text-amber-100/80">This connection is disabled in Sources, so its Home elements cannot load.</p>
          <button type="button" data-focusable onclick={() => enableConnection(connection)} class="shrink-0 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-xs font-bold text-amber-200">Enable</button>
        </div>
      {/if}

      <div class="mb-2 flex items-end justify-between gap-3">
        <div>
          <p class="text-xs font-black">Home elements</p>
          <p class="text-[11px] text-muted-foreground">Choose the individual lists that should appear on your Stremio Home.</p>
        </div>
        <a href="/app/settings/catalog/home?provider=stremio" data-focusable class="shrink-0 text-xs font-bold text-theme hover:underline">Full Home layout</a>
      </div>

      {#if connection?.manifest && rows.length}
        <div class="divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
          {#each rows as row (row.id)}
            <div class="flex min-h-12 items-center gap-3 px-3 py-2">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-bold">{row.title}</span>
                {#if row.group}<span class="block truncate text-[10px] text-muted-foreground">{row.group}</span>{/if}
              </span>
              {#if row.enabled}
                <button type="button" data-focusable onclick={() => removeFromHome(row.id)} class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-bold hover:bg-secondary">
                  <X size={13} /> Remove
                </button>
              {:else}
                <button type="button" data-focusable onclick={() => addToHome(row)} class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-bold text-primary-foreground">
                  <Plus size={13} /> Add to Home
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {manifestsReady ? 'No list elements were declared by this configuration.' : 'Loading your available lists…'}
        </div>
      {/if}

      <div class="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" data-focusable onclick={() => (configuring = provider)} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Reconfigure</button>
        <button type="button" data-focusable onclick={() => disconnect(provider)} class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10">Disconnect</button>
      </div>
    </SettingsRow>
  {/each}
</SettingsGroup>

{#if configuring}
  <AddonConfigurator
    name={configuring.name}
    expectedId={configuring.addonId}
    configureUrl={configuring.configureUrl}
    onCancel={() => (configuring = null)}
    onConfigured={(base) => saveConfiguration(configuring!, base)}
  />
{/if}
