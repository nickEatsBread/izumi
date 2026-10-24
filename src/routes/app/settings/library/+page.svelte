<script lang="ts">
  import { homeCollections } from '$lib/catalog/collections/store'
  import {
    catalogDefaultProvider,
    catalogLabel,
    catalogLastProvider,
    catalogLastScreen,
    catalogProvider,
    catalogProviders,
    catalogScreen,
    catalogScreens,
    catalogSwitcherPlacement,
    continueWatchingCatalogScope,
    customScreens,
    isJvmCatalogSourceEnabled,
    isMergedScreen,
    jvmCatalogSourceOverrides,
    normalizeCatalogProviders,
    omdbApiKey,
    resolveCatalogStartup,
    resolveCatalogScreenStartup,
    selectCatalogProvider,
    selectCatalogScreen,
    tmdbReadToken,
    type CatalogDefaultSelection,
    type CatalogSelection,
    type CatalogSwitcherPlacement,
    type ContinueWatchingCatalogScope,
  } from '$lib/settings/catalog'
  import {
    absoluteEpisodeNumbers, airingNotificationLeadMinutes, airingNotifications, browseLayout, cwDismissAction,
    episodeLayout, episodeQueueEnabled, hideSpoilers, ratingOnPage, ratingStyle, scheduleDefaultTab, scheduleLayout,
    scheduleShowNextUp, scheduleStickyHeader,
    type BrowseLayout, type CwDismissAction, type EpisodeLayout, type RatingOnPage, type RatingStyle,
    type ScheduleLayout, type ScheduleTab,
  } from '$lib/settings/ui'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { addonUrls, CINEMETA_BASE, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { isMobile, isTv } from '$lib/platform'
  import { gameMode } from '$lib/player/session'
  import { interfaceMode, type InterfaceMode } from '$lib/settings/interface-mode'
  import { setAiringNotificationsEnabled } from '$lib/notifications/airing'
  import { installedJvmCatalogSources, type JvmCatalogSource } from '$lib/extensions/manager'
  import { m } from '$lib/paraglide/messages.js'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import CredentialField from '$lib/components/settings/CredentialField.svelte'
  import HistorySettings from '$lib/components/settings/HistorySettings.svelte'
  import SceneBookmarkSettings from '$lib/components/settings/SceneBookmarkSettings.svelte'
  import CatalogPlatformRow from '$lib/components/catalog/CatalogPlatformRow.svelte'
  import CatalogScreensSettings from '$lib/components/catalog/CatalogScreensSettings.svelte'
  import JvmCatalogSourceRow from '$lib/components/catalog/JvmCatalogSourceRow.svelte'
  import JvmSourcePreferences from '$lib/components/catalog/JvmSourcePreferences.svelte'
  import TmdbCredentialGuide from '$lib/components/catalog/TmdbCredentialGuide.svelte'
  import ScoreScale from '$lib/components/detail/ScoreScale.svelte'
  import CircleHelp from '@lucide/svelte/icons/circle-help'

  const platforms: Array<{ id: CatalogSelection; label: string; description: string }> = [
    { id: 'auto', label: 'Automatic anime', description: 'AniList with automatic Kitsu and Jikan fallbacks.' },
    { id: 'anilist', label: 'AniList', description: 'Anime browsing, schedules, rich details, and search.' },
    { id: 'kitsu', label: 'Kitsu', description: 'Independent anime and manga catalogs.' },
    { id: 'tmdb', label: 'TMDB', description: 'Movies, television, and cross-database anime metadata.' },
    { id: 'stremio', label: 'Stremio metadata add-ons', description: 'Catalogs exposed by your enabled add-ons.' },
    { id: 'jvm', label: 'Aniyomi sources', description: 'Browse anime directly from installed Aniyomi sources.' },
  ]

  let jvmSources = $state<JvmCatalogSource[]>([])
  let jvmSourcesLoading = $state(false)
  let jvmSourcesLoaded = $state(false)
  let jvmSourcesError = $state('')
  let configuringJvmSource = $state<JvmCatalogSource | null>(null)
  let showTmdbGuide = $state(false)
  // Open while no token is saved: TMDB content cannot load without one.
  let tmdbOpen = $state(!$tmdbReadToken)
  let omdbOpen = $state(false)
  let advancedOpen = $state(false)

  const enabled = $derived(normalizeCatalogProviders($catalogProviders, $catalogProvider))
  const collectionsUseTmdb = $derived($homeCollections.some((collection) => collection.folders.some((folder) => folder.sources.some((source) => source.provider === 'tmdb'))))
  const defaultOptions = $derived([
    { value: 'adaptive', label: 'Adaptive · last selected' },
    ...catalogScreens($catalogProviders, $customScreens).map((id) => ({
      value: id,
      label: isMergedScreen(id) ? catalogLabel(id, $customScreens) : platforms.find((platform) => platform.id === id)?.label ?? id,
    })),
  ])
  const interfaceOptions = [
    { value: 'catalogs', label: 'Catalogs' },
    { value: 'search', label: 'Search box' },
  ]
  const continueWatchingOptions = [
    { value: 'provider', label: 'Current platform only' },
    { value: 'all', label: 'All platforms' },
  ]
  const switcherPlacementOptions = [
    { value: 'automatic', label: 'Automatic · integrated into Izumi logo' },
    { value: 'below', label: 'Below Izumi logo' },
    { value: 'integrated', label: 'Integrated into Izumi logo' },
  ]
  const hasPlatform = (id: CatalogSelection) => enabled.includes(id)
  const homeCustomizeProvider = $derived(isMergedScreen($catalogScreen)
    ? $catalogScreen
    : $catalogProvider === 'auto' ? 'anilist' : $catalogProvider)

  // Starting the extension runtime is heavy: wait until Advanced, which lists the sources, unfolds.
  $effect(() => {
    if (!advancedOpen || !hasPlatform('jvm') || jvmSourcesLoaded || jvmSourcesLoading) return
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
      selectCatalogScreen(resolveCatalogScreenStartup('adaptive', $catalogLastScreen, enabled, $customScreens))
      return
    }
    if (isMergedScreen(value) && catalogScreens($catalogProviders, $customScreens).includes(value)) {
      $catalogDefaultProvider = value
      selectCatalogScreen(value)
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
    if (value === 'automatic' || value === 'integrated' || value === 'below') {
      $catalogSwitcherPlacement = value as CatalogSwitcherPlacement
    }
  }

  function togglePlatform(id: CatalogSelection) {
    const current = normalizeCatalogProviders($catalogProviders, $catalogProvider)
    const turningOff = current.includes(id)
    if (turningOff && current.length === 1) return
    const next = turningOff ? current.filter((provider) => provider !== id) : [...current, id]
    $catalogProviders = next
    const nextScreens = catalogScreens(next, $customScreens)
    const nextDefault: CatalogDefaultSelection = $catalogDefaultProvider === 'adaptive'
      || nextScreens.includes($catalogDefaultProvider as typeof nextScreens[number]) ? $catalogDefaultProvider : next[0]
    $catalogDefaultProvider = nextDefault
    const fallback = resolveCatalogStartup(nextDefault, $catalogLastProvider, next)
    if (!next.includes($catalogProvider)) {
      if (isMergedScreen($catalogScreen) && nextScreens.includes($catalogScreen)) {
        $catalogProvider = fallback
        $catalogLastProvider = fallback
      } else {
        selectCatalogProvider(fallback)
      }
    }
    if (!nextScreens.includes($catalogScreen)) selectCatalogProvider(fallback)
  }

  function useKeylessCatalog() {
    $addonUrls = replaceAddonBase($addonUrls, undefined, CINEMETA_BASE)
    $disabledSources = $disabledSources.filter((url) => normalizeBase(url) !== CINEMETA_BASE)

    const current = normalizeCatalogProviders($catalogProviders, $catalogProvider)
    const next: CatalogSelection[] = [...current.filter((provider) => provider !== 'tmdb' && provider !== 'stremio'), 'stremio']
    $catalogProviders = next
    if ($catalogDefaultProvider === 'tmdb') $catalogDefaultProvider = 'stremio'
    selectCatalogProvider('stremio')
    showTmdbGuide = false
  }

  // Rows that used to be card grids on Interface: each option's description is the card's hint.
  const cwActions: { value: CwDismissAction; label: string; description: string }[] = [
    { value: 'none', label: 'Do nothing', description: 'Only hide it' },
    { value: 'paused', label: 'Set On Hold', description: 'Also set On Hold on your tracker' },
    { value: 'dropped', label: 'Set Dropped', description: 'Also set Dropped on your tracker' },
  ]
  const episodeLayouts: { value: EpisodeLayout; label: string; description: string }[] = [
    { value: 'cards', label: 'Cards', description: 'Thumbnails, ratings and progress' },
    { value: 'compact', label: 'Compact', description: 'Dense text rows, lighter on data' },
    { value: 'grid', label: 'Numbers', description: 'Number tiles for long-running shows' },
  ]
  const browseLayouts: { value: BrowseLayout; label: string; description: string }[] = [
    { value: 'grid', label: 'Grid', description: 'Cover-art tiles, three across' },
    { value: 'list', label: 'List', description: 'Compact rows with a small cover' },
  ]
  const scheduleLayouts: { value: ScheduleLayout; label: string; description: string }[] = [
    { value: 'agenda', label: 'Agenda', description: 'One long list, a section per day' },
    { value: 'days', label: 'Day at a time', description: 'One day at a time with tabs' },
  ]
  const scheduleTabs: { value: ScheduleTab; label: string; description: string }[] = [
    { value: 'schedule', label: 'Schedule', description: 'The weekly airing calendar' },
    { value: 'personal', label: 'Release calendar', description: 'Premieres, finales and streaming dates' },
    { value: 'watchlist', label: 'Watchlist', description: 'Your watching list, new episodes first' },
  ]
  const ratingStyles: { value: RatingStyle; label: string; description: string }[] = [
    { value: 'bar', label: 'Bar', description: 'Ten-segment bar' },
    { value: 'stars', label: 'Stars', description: 'Five stars with half steps' },
    { value: 'numbers', label: 'Numbers', description: 'Buttons from 1 to 10' },
    { value: 'dropdown', label: 'Dropdown', description: 'Menu of 1–10 with descriptors' },
  ]
  const ratingOnPageOptions: { value: RatingOnPage; label: string; description: string }[] = [
    { value: 'always', label: 'Always', description: 'Once you have started watching' },
    { value: 'rated', label: 'Once rated', description: 'Only after you have given a score' },
    { value: 'never', label: 'Hidden', description: 'Rate from the list editor only' },
  ]
  const leadOptions = [
    { value: '0', label: m.settings_when_it_airs() },
    { value: '10', label: m.settings_minutes_before({ minutes: 10 }) },
    { value: '30', label: m.settings_minutes_before({ minutes: 30 }) },
    { value: '60', label: m.settings_hour_before() },
  ]
  let ratingDemo = $state(8)

  let notificationError = $state('')
  async function toggleAiringNotifications() {
    notificationError = ''
    const granted = await setAiringNotificationsEnabled(!$airingNotifications)
    if (!granted) notificationError = m.settings_notification_permission_error()
  }
</script>

<SettingsSection section="library">
  <SettingsSubcategory id="home">
    <SettingsChoiceRow
      settingKey="interface-mode"
      title="Interface"
      description="Browse catalogs, or use one search box over your sources"
      learnMore="Search box lists releases from your tracker feeds and torrent extensions and plays the one you pick. Sources that need a title first, such as Stremio add-ons, are skipped there. Nothing is synced to trackers from that screen."
      value={$interfaceMode}
      options={interfaceOptions}
      onChange={(value) => ($interfaceMode = value as InterfaceMode)}
    />
    {#each platforms as platform (platform.id)}
      <CatalogPlatformRow
        platform={platform.id}
        label={platform.label}
        description={platform.description}
        enabled={hasPlatform(platform.id)}
        locked={hasPlatform(platform.id) && enabled.length === 1}
        settingKey={`catalog-platform-${platform.id}`}
        onToggle={() => togglePlatform(platform.id)}
      />
    {/each}
    <SettingsChoiceRow
      settingKey="default-catalog-platform"
      title="Default Home"
      description="A fixed catalog, or Adaptive to reopen the last one"
      learnMore="Merged appears when at least two distinct catalogs are enabled and joins them as another Home and Search destination. Catalog choices never disconnect tracker accounts; progress keeps using mapped IDs."
      value={$catalogDefaultProvider}
      options={defaultOptions}
      onChange={setDefaultPlatform}
    />
    <SettingsChoiceRow
      settingKey="continue-watching"
      title="Continue Watching"
      description="Active catalog only, or every platform combined"
      learnMore="Merged Home always combines them."
      value={$continueWatchingCatalogScope}
      options={continueWatchingOptions}
      onChange={setContinueWatchingScope}
    />
    <SettingsChoiceRow
      settingKey="remove-from-continue-watching"
      title="Remove from Continue Watching"
      description="Press D on a card to remove it; this can update your tracker"
      value={$cwDismissAction}
      options={cwActions}
      onChange={(value) => ($cwDismissAction = value as CwDismissAction)}
    />
    <SettingsRow
      title="Customize Home"
      description="Choose rows per Home screen, or use the pencil on Home"
      href={`/app/settings/library/home?provider=${homeCustomizeProvider}`}
      chevron
    />
    <SettingsRow
      title="Collections and covers"
      description="Import collections and set folder artwork"
      href="/app/settings/library/collections"
      chevron
    />
    {#if hasPlatform('tmdb') || collectionsUseTmdb}
      <SettingsRow
        settingKey="tmdb-token"
        title="TMDB read access token"
        description="Free personal credential, kept on this device"
        value={$tmdbReadToken ? 'Saved · hidden' : 'Not set'}
        onActivate={() => (tmdbOpen = !tmdbOpen)}
        expanded={tmdbOpen}
      >
        <button type="button" data-focusable onclick={() => (showTmdbGuide = true)} class="mb-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent">
          <CircleHelp size={15} aria-hidden="true" /> How to get a free token
        </button>
        <CredentialField bind:value={$tmdbReadToken} label="TMDB read access token" description="Paste the API Read Access Token from your TMDB account. Saved on this device." placeholder="eyJhbGciOiJIUzI1NiJ9…" />
      </SettingsRow>
      <!-- TMDB's attribution stays visible whether or not the credential row is open. -->
      <p class="px-3 py-2 text-xs text-muted-foreground">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    {/if}
    {#if hasPlatform('tmdb') || hasPlatform('stremio')}
      <SettingsRow
        settingKey="omdb-key"
        title="OMDb API key"
        description="Critic ratings for titles with an IMDb ID"
        learnMore="Adds Rotten Tomatoes, Metacritic, IMDb vote counts, and richer rating details. The keyless IMDb score continues to work without it."
        value={$omdbApiKey ? 'Saved · hidden' : 'Not set'}
        onActivate={() => (omdbOpen = !omdbOpen)}
        expanded={omdbOpen}
      >
        <button type="button" data-focusable onclick={() => openUrl('https://www.omdbapi.com/apikey.aspx')}
          class="mb-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent">
          Get a free OMDb key
        </button>
        <CredentialField bind:value={$omdbApiKey} label="OMDb API key" description="Optional: adds critic ratings where available. Saved on this device." />
        <p class="mt-2 text-xs text-muted-foreground">Stored only on this device. The free OMDb tier currently allows 1,000 requests per day.</p>
      </SettingsRow>
    {/if}
    {#if hasPlatform('stremio')}
      <SettingsRow
        title="Metadata add-ons"
        description="Add-ons with catalogs add rows to Home"
        value={$addonUrls.length ? `${$addonUrls.length} configured` : 'None yet'}
        href="/app/settings/sources"
        chevron
      />
    {/if}
  </SettingsSubcategory>
  <SettingsSubcategory id="screens">
    <CatalogScreensSettings />
  </SettingsSubcategory>

  <SettingsSubcategory id="layouts">
    <SettingsChoiceRow
      settingKey="episode-list-layout"
      title={m.settings_episode_layout()}
      value={$episodeLayout}
      options={episodeLayouts}
      onChange={(value) => ($episodeLayout = value as EpisodeLayout)}
    />
    <SettingsChoiceRow
      settingKey="browse-layout"
      title={m.settings_browse_layout()}
      value={$browseLayout}
      options={browseLayouts}
      onChange={(value) => ($browseLayout = value as BrowseLayout)}
    />
    <!-- Only the desktop schedule reads this: phones always show one day at a time and controller
         layouts (TV, Game mode) draw their own view. Search hides it there too. -->
    {#if !$isMobile && !$isTv && !$gameMode}
      <SettingsChoiceRow
        settingKey="schedule-layout"
        title={m.settings_schedule_layout()}
        description="Desktop view of the weekly schedule"
        value={$scheduleLayout}
        options={scheduleLayouts}
        onChange={(value) => ($scheduleLayout = value as ScheduleLayout)}
      />
    {/if}
    <SettingsChoiceRow
      settingKey="default-schedule-tab"
      title={m.settings_schedule_default_tab()}
      description="Anime catalogs; TMDB and Stremio open Release calendar"
      value={$scheduleDefaultTab}
      options={scheduleTabs}
      onChange={(value) => ($scheduleDefaultTab = value as ScheduleTab)}
    />
    <SettingsRow
      settingKey="show-next-up-on-the-schedule"
      title={'Show "Next up" on the schedule'}
      description="Soonest episodes above the schedule"
      onActivate={() => ($scheduleShowNextUp = !$scheduleShowNextUp)}
      pressed={$scheduleShowNextUp}
    >
      {#snippet control()}
        <SettingsSwitch value={$scheduleShowNextUp} onToggle={() => ($scheduleShowNextUp = !$scheduleShowNextUp)} label={'Show "Next up" on the schedule'} interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="ratings">
    <SettingsChoiceRow
      settingKey="rating-style"
      title="Rating style"
      description="Scoring control on the series page and list editor"
      value={$ratingStyle}
      options={ratingStyles}
      onChange={(value) => ($ratingStyle = value as RatingStyle)}
    />
    <!-- One line of rating steps for the d-pad (data-nav-line), whatever the style. -->
    <div data-nav-line class="px-3 py-2.5">
      <p class="mb-2 text-xs font-semibold text-muted-foreground">Preview — try it</p>
      <ScoreScale value={ratingDemo} onpick={(n) => (ratingDemo = n)} />
    </div>
    <SettingsChoiceRow
      settingKey="show-rating-on-the-series-page"
      title="Show rating on the series page"
      description="Under Play; Hidden keeps it in the list editor"
      value={$ratingOnPage}
      options={ratingOnPageOptions}
      onChange={(value) => ($ratingOnPage = value as RatingOnPage)}
    />
    <SettingsRow
      settingKey="hide-spoilers"
      title={m.settings_hide_spoilers()}
      description={m.settings_hide_spoilers_hint()}
      onActivate={() => ($hideSpoilers = !$hideSpoilers)}
      pressed={$hideSpoilers}
    >
      {#snippet control()}
        <SettingsSwitch value={$hideSpoilers} onToggle={() => ($hideSpoilers = !$hideSpoilers)} label={m.settings_hide_spoilers()} interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="notifications">
    <SettingsRow
      settingKey="episode-airing-notifications"
      title={m.settings_notifications()}
      description={m.settings_notifications_hint()}
      onActivate={toggleAiringNotifications}
      pressed={$airingNotifications}
    >
      {#snippet control()}
        <SettingsSwitch value={$airingNotifications} onToggle={toggleAiringNotifications} label={m.settings_notifications()} interactive={false} />
      {/snippet}
    </SettingsRow>
    {#if $airingNotifications}
      <SettingsChoiceRow
        title={m.settings_notify_me()}
        value={String($airingNotificationLeadMinutes)}
        options={leadOptions}
        onChange={(value) => ($airingNotificationLeadMinutes = Number(value))}
      />
    {/if}
    {#if notificationError}<p role="alert" class="px-3 py-2 text-xs text-amber-400">{notificationError}</p>{/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="history">
    <HistorySettings />
  </SettingsSubcategory>

  <SettingsSubcategory id="scenes">
    <SceneBookmarkSettings />
  </SettingsSubcategory>

  <SettingsSubcategory id="features">
    <SettingsRow
      settingKey="episode-queue"
      title="Episode queue"
      description="Queue buttons on episodes and an ordered list under Watchlist"
      onActivate={() => ($episodeQueueEnabled = !$episodeQueueEnabled)}
      pressed={$episodeQueueEnabled}
    >
      {#snippet control()}
        <SettingsSwitch value={$episodeQueueEnabled} onToggle={() => ($episodeQueueEnabled = !$episodeQueueEnabled)} label="Episode queue" interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="Catalog switcher, series-wide numbers, pinned schedule header" bind:open={advancedOpen}>
    <SettingsChoiceRow
      settingKey="catalog-switcher-placement"
      title="Catalog switcher"
      description="Where the catalog picker sits next to the logo"
      value={$catalogSwitcherPlacement}
      options={switcherPlacementOptions}
      onChange={setSwitcherPlacement}
    />
    {#if hasPlatform('jvm')}
      <SettingsRow
        settingKey="per-extension-catalogs"
        title="Per-extension catalogs"
        description="Which installed extensions add browse and search results"
      />
      {#if jvmSourcesLoading}
        <SettingsRow title="Loading extension catalogs…" description="Starting the extension runtime" />
      {:else if jvmSourcesError}
        <SettingsRow title="Couldn’t load extension catalogs" description={jvmSourcesError}>
          {#snippet control()}
            <button type="button" data-focusable onclick={() => void loadJvmSources()} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold">Retry</button>
          {/snippet}
        </SettingsRow>
      {:else if jvmSources.length}
        {#each jvmSources as source (source.id)}
          <JvmCatalogSourceRow
            {source}
            enabled={isJvmCatalogSourceEnabled(source.id, $jvmCatalogSourceOverrides)}
            onToggle={() => toggleJvmSource(source.id)}
            onSettings={() => (configuringJvmSource = source)}
          />
        {/each}
      {:else}
        <SettingsRow title="No enabled extensions" description="Install or enable an extension to use this catalog">
          {#snippet control()}
            <a href="/app/settings/store" data-focusable class="inline-flex min-h-9 items-center rounded-md bg-secondary px-3 text-xs font-bold">Add from Store</a>
          {/snippet}
        </SettingsRow>
      {/if}
    {/if}
    <SettingsRow
      settingKey="series-wide-episode-numbers"
      title="Series-wide episode numbers"
      description="Number episodes across the whole series, not per season"
      learnMore="Where the two differ, episode 5 of a second season shows as A29. Labels only — playback, downloads and tracking are unchanged."
      onActivate={() => ($absoluteEpisodeNumbers = !$absoluteEpisodeNumbers)}
      pressed={$absoluteEpisodeNumbers}
    >
      {#snippet control()}
        <SettingsSwitch value={$absoluteEpisodeNumbers} onToggle={() => ($absoluteEpisodeNumbers = !$absoluteEpisodeNumbers)} label="Series-wide episode numbers" interactive={false} />
      {/snippet}
    </SettingsRow>
    <SettingsRow
      settingKey="pin-schedule-header"
      title="Pin schedule header"
      description="Keep the calendar tabs and week controls on screen"
      learnMore="Off lets the header scroll away with the list, the default on Android. Ignored in Game mode."
      onActivate={() => ($scheduleStickyHeader = !$scheduleStickyHeader)}
      pressed={$scheduleStickyHeader}
    >
      {#snippet control()}
        <SettingsSwitch value={$scheduleStickyHeader} onToggle={() => ($scheduleStickyHeader = !$scheduleStickyHeader)} label="Pin schedule header" interactive={false} />
      {/snippet}
    </SettingsRow>
  </SettingsSubcategory>
</SettingsSection>

{#if configuringJvmSource}
  <JvmSourcePreferences
    sourceId={configuringJvmSource.id}
    sourceName={configuringJvmSource.name}
    onClose={() => (configuringJvmSource = null)}
  />
{/if}

{#if showTmdbGuide}
  <TmdbCredentialGuide onClose={() => (showTmdbGuide = false)} onUseKeyless={useKeylessCatalog} />
{/if}
