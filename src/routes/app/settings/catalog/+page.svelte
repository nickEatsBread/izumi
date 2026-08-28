<script lang="ts">
  import {
    catalogDefaultProvider,
    catalogLastProvider,
    catalogProvider,
    catalogProviders,
    catalogSwitcherPlacement,
    continueWatchingCatalogScope,
    isJvmCatalogSourceEnabled,
    jvmCatalogSourceOverrides,
    normalizeCatalogProviders,
    resolveCatalogStartup,
    selectCatalogProvider,
    tmdbReadToken,
    type CatalogDefaultSelection,
    type CatalogSelection,
    type CatalogSwitcherPlacement,
    type ContinueWatchingCatalogScope,
  } from '$lib/settings/catalog'
  import { addonUrls } from '$lib/stremio/sources'
  import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import CatalogPlatformRow from '$lib/components/catalog/CatalogPlatformRow.svelte'
  import JvmCatalogSourceRow from '$lib/components/catalog/JvmCatalogSourceRow.svelte'
  import { installedJvmCatalogSources, type JvmCatalogSource } from '$lib/extensions/manager'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import Boxes from '@lucide/svelte/icons/boxes'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import Coffee from '@lucide/svelte/icons/coffee'

  const platforms: Array<{ id: CatalogSelection; label: string; description: string }> = [
    { id: 'auto', label: 'Automatic anime', description: 'AniList with automatic Kitsu and Jikan fallbacks.' },
    { id: 'anilist', label: 'AniList', description: 'Anime browsing, schedules, rich details, and search.' },
    { id: 'kitsu', label: 'Kitsu', description: 'Independent anime and manga catalogs.' },
    { id: 'tmdb', label: 'TMDB', description: 'Movies, television, and cross-database anime metadata.' },
    { id: 'stremio', label: 'Stremio metadata add-ons', description: 'Catalogs exposed by your enabled add-ons.' },
    { id: 'jvm', label: 'JVM sources', description: 'Browse anime directly from installed Aniyomi sources.' },
  ]

  let jvmSources = $state<JvmCatalogSource[]>([])
  let jvmSourcesLoading = $state(false)
  let jvmSourcesLoaded = $state(false)
  let jvmSourcesError = $state('')

  const enabled = $derived(normalizeCatalogProviders($catalogProviders, $catalogProvider))
  const defaultOptions = $derived([
    { value: 'adaptive', label: 'Adaptive · last selected' },
    ...enabled.map((id) => ({
      value: id,
      label: platforms.find((platform) => platform.id === id)?.label ?? id,
    })),
  ])
  const continueWatchingOptions = [
    { value: 'provider', label: 'Current platform only' },
    { value: 'all', label: 'All platforms' },
  ]
  const switcherPlacementOptions = [
    { value: 'below', label: 'Below Izumi logo' },
    { value: 'integrated', label: 'Integrated into Izumi logo' },
  ]
  const hasPlatform = (id: CatalogSelection) => enabled.includes(id)
  const homeCustomizeProvider = $derived($catalogProvider === 'auto' ? 'anilist' : $catalogProvider)

  $effect(() => {
    if (!hasPlatform('jvm') || jvmSourcesLoaded || jvmSourcesLoading) return
    void loadJvmSources()
  })

  async function loadJvmSources() {
    jvmSourcesLoading = true
    jvmSourcesError = ''
    try {
      jvmSources = await installedJvmCatalogSources()
      jvmSourcesLoaded = true
    } catch (error) {
      jvmSourcesError = error instanceof Error ? error.message : String(error)
    } finally {
      jvmSourcesLoaded = true
      jvmSourcesLoading = false
    }
  }

  function toggleJvmSource(sourceId: string) {
    const next = !isJvmCatalogSourceEnabled(sourceId, $jvmCatalogSourceOverrides)
    $jvmCatalogSourceOverrides = { ...$jvmCatalogSourceOverrides, [sourceId]: next }
  }

  function setDefaultPlatform(value: string) {
    if (value === 'adaptive') {
      $catalogDefaultProvider = 'adaptive'
      selectCatalogProvider(resolveCatalogStartup('adaptive', $catalogLastProvider, enabled))
      return
    }
    if (!enabled.includes(value as CatalogSelection)) return
    $catalogDefaultProvider = value as CatalogSelection
    selectCatalogProvider(value as CatalogSelection)
  }

  function setContinueWatchingScope(value: string) {
    if (value === 'provider' || value === 'all') {
      $continueWatchingCatalogScope = value as ContinueWatchingCatalogScope
    }
  }

  function setSwitcherPlacement(value: string) {
    if (value === 'integrated' || value === 'below') {
      $catalogSwitcherPlacement = value as CatalogSwitcherPlacement
    }
  }

  function togglePlatform(id: CatalogSelection) {
    const current = normalizeCatalogProviders($catalogProviders, $catalogProvider)
    const turningOff = current.includes(id)
    if (turningOff && current.length === 1) return
    const next = turningOff ? current.filter((provider) => provider !== id) : [...current, id]
    $catalogProviders = next
    const nextDefault: CatalogDefaultSelection = $catalogDefaultProvider === 'adaptive'
      || next.includes($catalogDefaultProvider) ? $catalogDefaultProvider : next[0]
    $catalogDefaultProvider = nextDefault
    if (!next.includes($catalogProvider)) {
      selectCatalogProvider(resolveCatalogStartup(nextDefault, $catalogLastProvider, next))
    }
  }
</script>

{#snippet defaultControl()}
  <SelectMenu
    className="w-full sm:w-48"
    value={$catalogDefaultProvider}
    options={defaultOptions}
    onChange={setDefaultPlatform}
    ariaLabel="Default catalog platform"
  />
{/snippet}

{#snippet continueWatchingControl()}
  <SelectMenu
    className="w-full sm:w-48"
    value={$continueWatchingCatalogScope}
    options={continueWatchingOptions}
    onChange={setContinueWatchingScope}
    ariaLabel="Continue Watching catalog scope"
  />
{/snippet}

{#snippet switcherPlacementControl()}
  <SelectMenu
    className="w-full sm:w-56"
    value={$catalogSwitcherPlacement}
    options={switcherPlacementOptions}
    onChange={setSwitcherPlacement}
    ariaLabel="Catalog switcher placement"
  />
{/snippet}

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Catalog</h2>
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">Enable one or more platforms and choose how catalog selection appears. Quick search checks all enabled platforms.</p>

  <SettingsGroup icon={LibraryBig} title="Catalog platforms" desc="Choose where the picker appears and which platform opens first.">
    <SettingsRow
      settingKey="default-catalog-platform"
      title="Default platform"
      description="Choose a fixed startup platform, or Adaptive to reopen the last platform you selected."
      control={defaultControl}
      controlLayout="stack"
    />
    <SettingsRow
      settingKey="catalog-switcher-placement"
      title="Catalog switcher"
      description="Integrate catalog selection into the Izumi logo, or show a more visible provider row below it."
      control={switcherPlacementControl}
      controlLayout="stack"
    />
    <SettingsRow
      settingKey="continue-watching"
      title="Continue Watching"
      description="Show progress for the active catalog or combine all platforms."
      control={continueWatchingControl}
      controlLayout="stack"
    />
    {#each platforms as platform (platform.id)}
      <CatalogPlatformRow
        platform={platform.id}
        label={platform.label}
        description={platform.description}
        enabled={hasPlatform(platform.id)}
        locked={hasPlatform(platform.id) && enabled.length === 1}
        settingKey={platform.id === 'auto' ? 'catalog-provider' : undefined}
        onToggle={() => togglePlatform(platform.id)}
      />
    {/each}
  </SettingsGroup>

  <SettingsGroup icon={SlidersHorizontal} title="Home layout" desc="Control Home separately for each catalog platform.">
    <SettingsRow title="Home rows" description="Show, hide, and reorder discovery rows without changing your enabled catalogs.">
      <a href={`/app/settings/catalog/home?provider=${homeCustomizeProvider}`} data-focusable class="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Customize Home</a>
    </SettingsRow>
  </SettingsGroup>

  {#if hasPlatform('tmdb')}
    <SettingsGroup icon={KeyRound} title="TMDB access">
      <SettingsRow title="Read access token" description="A personal free non-commercial credential; stored only on this device.">
        <p class="mb-2 text-xs text-muted-foreground">
          Create one in your
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" data-focusable class="font-bold text-theme underline underline-offset-2 hover:no-underline">TMDB API settings</a>.
        </p>
        <input bind:value={$tmdbReadToken} type="password" autocomplete="off" spellcheck="false" data-focusable
          placeholder="eyJhbGciOiJIUzI1NiJ9…" aria-label="TMDB read access token"
          class="h-11 w-full rounded-md bg-input px-3 font-mono text-base sm:h-10 sm:text-sm" />
        <p class="mt-2 text-[11px] text-muted-foreground">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </SettingsRow>
    </SettingsGroup>
  {/if}

  {#if hasPlatform('stremio')}
    <SettingsGroup icon={Boxes} title="Stremio metadata">
      <SettingsRow title="Configured add-ons" description="Only add-ons declaring catalog and meta resources are used.">
        <p class="text-xs text-muted-foreground">{$addonUrls.length ? `${$addonUrls.length} configured add-on${$addonUrls.length === 1 ? '' : 's'} will be checked.` : 'No add-ons are configured yet.'}</p>
        {#if !$addonUrls.length}<a href="/app/settings/sources" data-focusable class="mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Add a source</a>{/if}
      </SettingsRow>
    </SettingsGroup>
  {/if}

  {#if hasPlatform('jvm')}
    <SettingsGroup icon={Coffee} title="JVM catalog sources" desc="Choose which enabled Aniyomi sources contribute browsing and search results.">
      {#if jvmSourcesLoading}
        <SettingsRow title="Loading JVM sources…" description="Starting the extension runtime and reading installed providers." />
      {:else if jvmSourcesError}
        <SettingsRow title="Couldn’t load JVM sources" description={jvmSourcesError}>
          <button type="button" data-focusable onclick={() => void loadJvmSources()} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold">Retry</button>
        </SettingsRow>
      {:else if jvmSources.length}
        {#each jvmSources as source (source.id)}
          <JvmCatalogSourceRow
            {source}
            enabled={isJvmCatalogSourceEnabled(source.id, $jvmCatalogSourceOverrides)}
            onToggle={() => toggleJvmSource(source.id)}
          />
        {/each}
      {:else}
        <SettingsRow title="No enabled JVM sources" description="Install or enable an Aniyomi source before using the JVM catalog.">
          <a href="/app/settings/store" data-focusable class="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Add from Store</a>
        </SettingsRow>
      {/if}
    </SettingsGroup>
  {/if}

  <p class="max-w-2xl px-1 text-xs text-muted-foreground">Catalog choices do not disconnect tracker accounts. Progress updates continue using mapped IDs when available.</p>
</div>
