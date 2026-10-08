<script lang="ts">
  import { goto } from '$app/navigation'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { heroQuery, heroVars, homeSections } from '$lib/anilist/queries'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import RecentReleaseRow from '$lib/components/cards/RecentReleaseRow.svelte'
  import PersonalizedRow from '$lib/components/cards/PersonalizedRow.svelte'
  import Hero from '$lib/components/banner/Hero.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'
  import { isAndroid, isMobile } from '$lib/platform'
  import { offlineMode } from '$lib/stores/offline'
  import DownloadedLibrary from '$lib/components/offline/DownloadedLibrary.svelte'
  import * as h from '$lib/haptics'
  import { homeHeaderNav, NAV_META } from '$lib/settings/nav'
  import type { Media } from '$lib/anilist/types'
  import { anilistDegraded, anilistDegradedBannerVisible } from '$lib/anilist/degraded'
  import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
  import { homeEditorOpen } from '$lib/catalog/home-editor'
  import { ANILIST_HOME_ROWS } from '$lib/catalog/home-options'
  import { activeThemeLayout } from '$lib/themes/layout-state'
  import { themePresentation } from '$lib/themes/runtime'
  import MediaListSheet from '$lib/components/detail/MediaListSheet.svelte'
  import { isThemeBlockId, resolveThemeHome } from '$lib/home/theme-layout'
  import { markClientPerformance } from '$lib/performance/client'
  import {
    catalogProvider,
    catalogScreen,
    catalogProviders,
    catalogSwitcherPlacement,
    enabledCatalogScreens,
    isLegacyAniListCatalog,
    mergedCatalogProviders,
    resolveCatalogSwitcherPlacement,
  } from '$lib/settings/catalog'
  import CatalogHome from '$lib/components/catalog/CatalogHome.svelte'
  import CollectionsHome from '$lib/components/catalog/CollectionsHome.svelte'
  import MergedCatalogHome from '$lib/components/catalog/MergedCatalogHome.svelte'
  import CatalogSwitcher from '$lib/components/catalog/CatalogSwitcher.svelte'
  import CatalogBrandLogo from '$lib/components/catalog/CatalogBrandLogo.svelte'
  import HomeEditor from '$lib/components/catalog/HomeEditor.svelte'
  import HomeRowFrame from '$lib/components/catalog/HomeRowFrame.svelte'
  import HomeBlockView from '$lib/components/home/HomeBlockView.svelte'
  import HomeColumns from '$lib/components/home/HomeColumns.svelte'
  import { blockRowOptions, blockTitle, splitHomeColumns } from '$lib/home/block-rows'
  import { homeAsideWidth, homeBlocks, isBlockId } from '$lib/home/blocks'
  import { mediaHref } from '$lib/anilist/media'
  import { rankFeaturedMedia } from '$lib/catalog/featured-context'

  const client = getContextClient()
  const legacyCatalog = $derived(isLegacyAniListCatalog($catalogProvider))
  const mergedUsesAniList = $derived(mergedCatalogProviders($catalogProviders).some((provider) => isLegacyAniListCatalog(provider)))
  const usesAniListHome = $derived($catalogScreen === 'merged' ? mergedUsesAniList : legacyCatalog)
  const sections = homeSections(new Date())

  // Top-bar icons come from the nav config (items the user placed 'top'), or the theme's header list,
  // which may repeat a bottom-bar tab as a shortcut (Theme API 4).
  const topNav = $derived($homeHeaderNav)

  // Personalized rows use the connected AniList account name (from OAuth) if present,
  // otherwise the manually-entered username.
  const listUser = $derived($anilistUserName || $anilistUser)
  const anilistRows = $derived(resolveCatalogHomeRows('anilist', [...ANILIST_HOME_ROWS, ...blockRowOptions('anilist', $catalogHomeLayouts, $homeBlocks)], $catalogHomeLayouts)
    .filter((row) => row.enabled))
  const rowOptionIds = ANILIST_HOME_ROWS.map((row) => row.id)
  // While a theme layout is active, it replaces the row order below (the user's own layout, in
  // `catalogHomeLayouts`, is never written to); its ephemeral `theme:<n>` blocks join `$homeBlocks`
  // for lookups so a theme block renders exactly like a real one.
  const themeHome = $derived($activeThemeLayout?.home ? resolveThemeHome($activeThemeLayout.home, $catalogProvider, rowOptionIds) : null)
  const allBlocks = $derived(themeHome ? { ...$homeBlocks, ...themeHome.blocks } : $homeBlocks)
  const orderedRows = $derived(themeHome?.rows ?? anilistRows.map((row) => row.id))
  // The hero renders full-bleed above HomeColumns only while it truly leads the row order; while
  // Edit Home is open it always flows through HomeColumns instead, so it can be dragged/hidden like
  // any other row (it would otherwise have no frame to grab while sitting in the unwrapped top slot).
  const heroFirst = $derived(!$homeEditorOpen && orderedRows[0] === 'hero')
  const homeRowIds = $derived(heroFirst ? orderedRows.slice(1) : orderedRows)
  // While Edit Home is open, phones must still show every block (including a side-column one that
  // opted out of `phone`), or there would be no way to reach its settings/remove button on a phone.
  const columns = $derived(splitHomeColumns(homeRowIds, allBlocks, $isMobile && !$homeEditorOpen))
  const sectionMap = $derived(new Map(sections.map((section) => [section.key, section])))
  const catalogUnavailable = $derived(!!$anilistDegraded?.fallbackError)

  // Rate limits (429) are retried inside the AniList client; hard catalog failures are offered to
  // Jikan there. If BOTH providers fail, this store may still error — that must only remove the
  // public hero, never replace Continue Watching / MAL / local rows with a full-page error.
  type HeroResult = { fetching: boolean; error?: { message: string }; data?: { Page: { media: Media[] } } }

  let heroStore = $state<ReturnType<typeof makeHeroStore> | null>(null)
  let hero = $state<HeroResult>({ fetching: true })
  // Theme API 4: the hero's pool (`source`) and slide count (`limit`).
  const heroTheme = $derived($themePresentation?.hero)
  const heroSource = $derived(heroTheme?.source ?? 'season')
  const heroLimit = $derived(heroTheme?.limit ?? 7)
  // A template hero's list action opens the list editor for that slide's title.
  let listMedia = $state<Media | null>(null)

  function makeHeroStore(pause: boolean, source: 'season' | 'trending') {
    return queryStore<{ Page: { media: Media[] } }>({
      client,
      query: heroQuery(),
      variables: heroVars(new Date(), source),
      pause,
    })
  }

  // Switching away from anime creates a paused query; switching back must create a fresh live
  // store. Keeping the first paused store forever is why the anime platform had no hero carousel
  // after TMDB had been active at startup. A theme that changes the pool gets a store of its own.
  $effect(() => {
    const active = usesAniListHome
    const source = heroSource
    hero = { fetching: active }
    heroStore = makeHeroStore(!active, source)
  })

  // Re-subscribe whenever a platform change recreates the hero store. The subscribe's
  // unsubscriber becomes the effect's teardown, so the old store is dropped first.
  // Skip the trending query entirely in offline mode (the offline branch never renders the hero).
  $effect(() => {
    if ($offlineMode || !heroStore) return
    return heroStore.subscribe((v) => (hero = v as HeroResult))
  })

  const canCycleCatalog = $derived($enabledCatalogScreens.length > 1)
  const switcherPlacement = $derived(resolveCatalogSwitcherPlacement($catalogSwitcherPlacement, $isAndroid))

  // Only titles that have real landscape art: a bannerImage, or a YouTube trailer whose maxres
  // thumbnail banner() falls back to. Everything else would paint a stretched portrait cover.
  //
  // The 15 fetched titles are then ordered by a Knuth multiplicative hash of the id, NOT by score.
  // Taking the top 7 by score meant ranks 8-15 could never be featured, so the hero was the same
  // handful of titles all season; hashing spreads the pick across the whole pool while staying
  // STABLE per title (no reshuffle on every load, no Math.random in a $derived).
  //
  // A theme's `source: "trending"` features the titles trending now in trending order instead,
  // artwork or not (a phone hero built on the cover does not need landscape art).
  const heroMedias = $derived.by(() => {
    const pool = hero.data?.Page.media ?? []
    if (heroSource === 'trending') return rankFeaturedMedia(pool, 'Trending Now').slice(0, heroLimit)
    const all = rankFeaturedMedia(pool, 'Top Rated This Season')
    const withArt = all.filter((m) => m.bannerImage ?? m.trailer?.id)
    return (withArt.length ? withArt : all)
      .slice()
      .sort((a, b) => ((a.id * 2654435761) >>> 0) - ((b.id * 2654435761) >>> 0))
      .slice(0, heroLimit)
  })
  // The loading placeholder takes the box of the hero that will replace it: a theme's template hero
  // is full-bleed at its own height, izumi's own phone card and desktop banner keep their shapes.
  // `home.hero[data-state="loading"]` lets a stylesheet size it like its hero beyond that.
  const heroPlaceholderHeight = $derived(($isMobile ? heroTheme?.mobileHeight : heroTheme?.height) ?? 46)
  // As Hero.svelte sizes a template: `banner` on every window, `wide` above a phone (its `bleed`
  // overlap is left to the hero itself).
  const heroPlaceholderScale = $derived(heroTheme?.scale === 'banner' ? 'banner' : !$isMobile && heroTheme?.scale === 'wide' ? 'wide' : undefined)
  const homeNeedsAlertInset = $derived(legacyCatalog && $anilistDegradedBannerVisible && heroMedias.length === 0)
  let homePaintMarked = false
  $effect(() => {
    const contentReady = $offlineMode || !hero.fetching || catalogUnavailable
    if (!contentReady || homePaintMarked) return
    homePaintMarked = true
    requestAnimationFrame(() => requestAnimationFrame(() => markClientPerformance(
      'izumi:home-content-painted',
      { offline: $offlineMode, heroItems: heroMedias.length },
    )))
  })

</script>

{#if $isMobile}
  <!-- Top app bar: brand mark + wordmark on the left, configured top icons on the right. In-flow
       (NOT pinned) so it only shows at the very top and scrolls away with the page. Kept ABOVE the
       offline/online split so the offline home shares the same chrome. -->
  <!-- pt-3 only: <main> already adds env(safe-area-inset-top) on mobile, so re-adding it here
       double-counted the status-bar inset and left a big black gap above the logo. -->
  <!-- The degraded strip is fixed at the same safe-area edge as this in-flow toolbar. Reserve its
       height while visible so the logo and top actions remain fully tappable on Android. -->
  <div data-slot="home.header" class="px-4 pb-3 pt-3 {usesAniListHome && $anilistDegradedBannerVisible ? 'mt-7' : ''}">
    <div class="flex items-center justify-between">
      {#if !$offlineMode && switcherPlacement === 'integrated' && canCycleCatalog}
        <CatalogSwitcher display="brand" showWordmark />
      {:else}
        <div class="flex items-center gap-2" aria-label="izumi">
          <CatalogBrandLogo platform={$catalogScreen} />
          <img src="/brand/izumi-wordmark-white.svg" alt="izumi" data-theme-protected class="home-wordmark" draggable="false" />
        </div>
      {/if}
      {#if topNav.length}
      <div data-part="home.header.actions" class="flex items-center gap-1">
        {#each topNav as c (c.id)}
          {@const meta = NAV_META[c.id]}
          {@const Icon = meta.icon}
          <a data-part="home.header.action" data-dest={c.id} href={meta.href} data-focusable aria-label={meta.label} onclick={() => h.tap()}
             class="grid size-9 place-items-center rounded-full text-foreground transition-colors active:bg-white/10">
            <Icon size={22} />
          </a>
        {/each}
      </div>
      {/if}
    </div>
    {#if !$offlineMode && switcherPlacement === 'below' && canCycleCatalog}
      <CatalogSwitcher display="value" appearance="surface" className="mt-2" />
    {/if}
  </div>
{/if}

{#if !$offlineMode}<HomeEditor target={$catalogScreen} />{/if}

<style>
  /* The brand's rem (app.css), so a theme's phone root size never changes the wordmark. */
  .home-wordmark { height: calc(1.25 * var(--izumi-safe-rem)); }
  :global(html[data-scheme='light']) .home-wordmark {
    filter: brightness(0) saturate(100%);
  }
</style>

{#if $offlineMode}
  <!-- Offline: local-first Continue Watching + the downloaded-series library. No network fired. -->
  <div data-slot="home" data-variant="offline" class="space-y-4 pb-16 pt-2">
    {#if orderedRows.includes('continue')}
      {#key listUser}
        <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
      {/key}
    {/if}
    <DownloadedLibrary />
  </div>
{:else if $catalogScreen === 'merged'}
  <MergedCatalogHome anilistHero={heroMedias} />
{:else if !legacyCatalog}
  <CatalogHome />
{:else}
  <!-- With no hero, the first row must clear the fixed desktop titlebar + degraded strip. Mobile's
       toolbar above already reserves the alert height, so this extra inset is desktop-only. -->
  <div data-slot="home" data-variant="anilist" class="pb-16 {homeNeedsAlertInset ? 'sm:pt-[3.75rem]' : ''}">
    {#snippet heroBlock()}
      {#if !catalogUnavailable && heroMedias.length}
        <Hero medias={heroMedias} onplay={(m) => goto(mediaHref(m))} oninfo={(m) => goto(mediaHref(m))} onlist={(m) => (listMedia = m)} />
      {:else if !catalogUnavailable && hero.fetching && !heroTheme?.hidden}
        {#if heroTheme?.template}
          <div data-slot="home.hero" data-state="loading" data-variant="template" aria-hidden="true" class="relative mb-6 min-h-[24vh] overflow-hidden bg-muted"
               style:height={heroPlaceholderScale ? undefined : `${heroPlaceholderHeight}vh`}
               style:aspect-ratio={heroPlaceholderScale === 'wide' ? '16 / 9' : heroPlaceholderScale === 'banner' ? '5 / 1' : undefined}
               style:min-height={heroPlaceholderScale === 'wide' ? '24rem' : heroPlaceholderScale === 'banner' ? '25rem' : undefined}
               style:max-height={heroPlaceholderScale === 'wide' ? '85vh' : heroPlaceholderScale === 'banner' ? '30rem' : undefined}>
            <div class="absolute inset-0 skeloader"></div>
          </div>
        {:else if $isMobile}
          <div data-slot="home.hero" data-state="loading" data-variant="phone" aria-hidden="true" class="relative mx-4 mb-6 h-[46vh] overflow-hidden rounded-2xl bg-muted shadow-xl"
               style:height={heroTheme?.mobileHeight ? `${heroTheme.mobileHeight}vh` : undefined}>
            <div class="absolute inset-0 skeloader"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
            <div class="absolute inset-x-0 bottom-0 space-y-3 p-4">
              <div class="h-7 w-3/4 rounded skeloader"></div>
              <div class="h-3 w-1/2 rounded skeloader"></div>
              <div class="grid grid-cols-[1fr_auto] gap-2"><div class="h-11 rounded-lg skeloader"></div><div class="h-11 w-24 rounded-lg skeloader"></div></div>
            </div>
          </div>
        {:else}
          <div data-slot="home.hero" data-state="loading" data-variant="desktop" aria-hidden="true" class="relative mb-6 h-[50vh] overflow-hidden bg-muted"
               style:height={heroTheme?.height ? `${heroTheme.height}vh` : undefined}>
            <div class="absolute inset-0 skeloader"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
            <div class="absolute bottom-8 left-8 w-[34rem] space-y-4"><div class="h-10 w-4/5 rounded skeloader"></div><div class="h-4 w-2/3 rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-10 w-48 rounded-lg skeloader"></div></div>
          </div>
        {/if}
      {/if}
    {/snippet}

    {#if heroFirst}{@render heroBlock()}{/if}
    <CollectionsHome />
    {#snippet homeRow(row: string)}
      {@const rowOption = anilistRows.find((option) => option.id === row) ?? (isThemeBlockId(row) ? { id: row, title: blockTitle(allBlocks[row]) } : ANILIST_HOME_ROWS.find((option) => option.id === row))}
      {@const visibleIds = columns.main.includes(row) ? columns.main : columns.aside}
      <HomeRowFrame rowId={row} title={rowOption?.title ?? row} target={$catalogProvider} {visibleIds} locked={!!themeHome}>
        {#if row === 'hero'}
          {@render heroBlock()}
        {:else if isBlockId(row) || isThemeBlockId(row)}
          <HomeBlockView id={row} target={$catalogProvider} optionIds={rowOptionIds} block={allBlocks[row]} />
        {:else if row === 'continue'}
          {#key listUser}
            <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
          {/key}
        {:else if row === 'recent'}
          {#if !catalogUnavailable}<RecentReleaseRow />{/if}
        {:else if row === 'list'}
          {#if listUser}
            {#key listUser}<ListRow title="Your List" userName={listUser} status="PLANNING" preferLinkedRating={$catalogProvider === 'auto'} />{/key}
          {/if}
          {#if $malToken || $malUser}<MalListRow title="Your List" status="plan_to_watch" preferLinkedRating={$catalogProvider === 'auto'} />{/if}
        {:else if row === 'recommendations'}
          {#key listUser}<PersonalizedRow userName={listUser} preferLinkedRating={$catalogProvider === 'auto'} />{/key}
        {:else}
          {@const section = sectionMap.get(row)}
          {#if section && !catalogUnavailable}<HomeRow title={section.title} vars={section.vars} preferLinkedRating={$catalogProvider === 'auto'} />{/if}
        {/if}
      </HomeRowFrame>
    {/snippet}
    <HomeColumns main={columns.main} aside={columns.aside} asideWidth={$activeThemeLayout?.asideWidth ?? $homeAsideWidth} asideGap={$activeThemeLayout?.asideGap} asideStart={$activeThemeLayout?.asideStart} row={homeRow} />
  </div>
  {#if listMedia}<MediaListSheet media={listMedia} onclose={() => (listMedia = null)} />{/if}
{/if}
