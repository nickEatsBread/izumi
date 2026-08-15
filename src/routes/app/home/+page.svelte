<script lang="ts">
  import { goto } from '$app/navigation'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { heroQuery, heroVars, homeSections } from '$lib/anilist/queries'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import PersonalizedRow from '$lib/components/cards/PersonalizedRow.svelte'
  import Hero from '$lib/components/banner/Hero.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'
  import { isMobile } from '$lib/platform'
  import { offlineMode } from '$lib/stores/offline'
  import DownloadedLibrary from '$lib/components/offline/DownloadedLibrary.svelte'
  import * as h from '$lib/haptics'
  import { effectiveNav, NAV_META } from '$lib/settings/nav'
  import type { Media } from '$lib/anilist/types'
  import { anilistDegraded } from '$lib/anilist/degraded'
  import { DEFAULT_HOME_ROWS, hiddenHomeRows, homeRowOrder, type HomeRowId } from '$lib/settings/ui'

  const client = getContextClient()
  const sections = homeSections(new Date())

  // Top-bar icons come from the nav config (items the user placed 'top').
  const topNav = $derived($effectiveNav.filter((c) => c.placement === 'top'))

  // Personalized rows use the connected AniList account name (from OAuth) if present,
  // otherwise the manually-entered username.
  const listUser = $derived($anilistUserName || $anilistUser)
  const orderedRows = $derived.by(() => {
    const valid = new Set<string>(DEFAULT_HOME_ROWS)
    const saved = $homeRowOrder.filter((id) => valid.has(id))
    const order = [...saved, ...DEFAULT_HOME_ROWS.filter((id) => !saved.includes(id))]
    return order.filter((id) => !$hiddenHomeRows.includes(id)) as HomeRowId[]
  })
  const sectionMap = $derived(new Map(sections.map((section) => [section.key, section])))
  const catalogUnavailable = $derived(!!$anilistDegraded?.fallbackError)

  // Rate limits (429) are retried inside the AniList client; hard catalog failures are offered to
  // Jikan there. If BOTH providers fail, this store may still error — that must only remove the
  // public hero, never replace Continue Watching / MAL / local rows with a full-page error.
  type HeroResult = { fetching: boolean; error?: { message: string }; data?: { Page: { media: Media[] } } }

  let heroStore = $state(makeHeroStore())
  let hero = $state<HeroResult>({ fetching: true })

  function makeHeroStore() {
    return queryStore<{ Page: { media: Media[] } }>({
      client,
      query: heroQuery(),
      variables: heroVars(new Date()),
    })
  }

  // Re-subscribe whenever the hero store is recreated (on retry). The subscribe's
  // unsubscriber becomes the effect's teardown, so the old store is dropped first.
  // Skip the trending query entirely in offline mode (the offline branch never renders the hero).
  $effect(() => {
    if ($offlineMode) return
    return heroStore.subscribe((v) => (hero = v as HeroResult))
  })

  // Only titles that have real landscape art: a bannerImage, or a YouTube trailer whose maxres
  // thumbnail banner() falls back to. Everything else would paint a stretched portrait cover.
  //
  // The 15 fetched titles are then ordered by a Knuth multiplicative hash of the id, NOT by score.
  // Taking the top 7 by score meant ranks 8-15 could never be featured, so the hero was the same
  // handful of titles all season; hashing spreads the pick across the whole pool while staying
  // STABLE per title (no reshuffle on every load, no Math.random in a $derived).
  const heroMedias = $derived.by(() => {
    const all = hero.data?.Page.media ?? []
    const withArt = all.filter((m) => m.bannerImage ?? m.trailer?.id)
    return (withArt.length ? withArt : all)
      .slice()
      .sort((a, b) => ((a.id * 2654435761) >>> 0) - ((b.id * 2654435761) >>> 0))
      .slice(0, 7)
  })
  const homeNeedsAlertInset = $derived(!!$anilistDegraded && heroMedias.length === 0)

</script>

{#if $isMobile}
  <!-- Top app bar: brand mark + wordmark on the left, configured top icons on the right. In-flow
       (NOT pinned) so it only shows at the very top and scrolls away with the page. Kept ABOVE the
       offline/online split so the offline home shares the same chrome. -->
  <!-- pt-3 only: <main> already adds env(safe-area-inset-top) on mobile, so re-adding it here
       double-counted the status-bar inset and left a big black gap above the logo. -->
  <div class="flex items-center justify-between px-4 pb-3 pt-3">
    <a href="/app/home" aria-label="Home" class="flex items-center gap-2">
      <img src="/brand/izumi-mark-color.svg" alt="" class="h-7 w-7" draggable="false" />
      <img src="/brand/izumi-wordmark-white.svg" alt="izumi" class="home-wordmark h-5" draggable="false" />
    </a>
    {#if topNav.length}
      <div class="flex items-center gap-1">
        {#each topNav as c (c.id)}
          {@const meta = NAV_META[c.id]}
          {@const Icon = meta.icon}
          <a href={meta.href} data-focusable aria-label={meta.label} onclick={() => h.tap()}
             class="grid size-9 place-items-center rounded-full text-foreground transition-colors active:bg-white/10">
            <Icon size={22} />
          </a>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(html[data-scheme='light']) .home-wordmark {
    filter: brightness(0) saturate(100%);
  }
</style>

{#if $offlineMode}
  <!-- Offline: local-first Continue Watching + the downloaded-series library. No network fired. -->
  <div class="space-y-4 pb-16 pt-2">
    {#key listUser}
      <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
    {/key}
    <DownloadedLibrary />
  </div>
{:else}
  <!-- With no hero, the first row must clear the fixed desktop titlebar + degraded strip. The hero
       normally owns that edge-to-edge space, so keep the inset scoped to the all-catalogs-down
       branch and leave the healthy Home composition unchanged. -->
  <div class="pb-16 {homeNeedsAlertInset ? 'pt-7 sm:pt-[3.75rem]' : ''}">
    {#if !catalogUnavailable && heroMedias.length}
      <Hero medias={heroMedias} onplay={(m) => goto(`/app/anime/${m.id}`)} oninfo={(m) => goto(`/app/anime/${m.id}`)} />
    {:else if !catalogUnavailable && hero.fetching}
      {#if $isMobile}
        <div class="relative mx-4 mb-6 h-[46vh] overflow-hidden rounded-2xl bg-muted shadow-xl">
          <div class="absolute inset-0 skeloader"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
          <div class="absolute inset-x-0 bottom-0 space-y-3 p-4">
            <div class="h-7 w-3/4 rounded skeloader"></div>
            <div class="h-3 w-1/2 rounded skeloader"></div>
            <div class="grid grid-cols-[1fr_auto] gap-2"><div class="h-11 rounded-lg skeloader"></div><div class="h-11 w-24 rounded-lg skeloader"></div></div>
          </div>
        </div>
      {:else}
        <div class="relative mb-6 h-[55vh] overflow-hidden bg-muted">
          <div class="absolute inset-0 skeloader"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
          <div class="absolute bottom-8 left-8 w-[34rem] space-y-4"><div class="h-10 w-4/5 rounded skeloader"></div><div class="h-4 w-2/3 rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-10 w-48 rounded-lg skeloader"></div></div>
        </div>
      {/if}
    {/if}

    {#each orderedRows as row (row)}
      {#if row === 'continue'}
        {#key listUser}
          <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
        {/key}
      {:else if row === 'list'}
        {#if listUser}
          {#key listUser}<ListRow title="Your List" userName={listUser} status="PLANNING" />{/key}
        {/if}
        {#if $malToken || $malUser}<MalListRow title="Your List" status="plan_to_watch" />{/if}
      {:else if row === 'recommendations'}
        {#if listUser}{#key listUser}<PersonalizedRow userName={listUser} />{/key}{/if}
      {:else}
        {@const section = sectionMap.get(row)}
        {#if section && !catalogUnavailable}<HomeRow title={section.title} vars={section.vars} />{/if}
      {/if}
    {/each}
  </div>
{/if}
