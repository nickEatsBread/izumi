<script lang="ts">
  import { goto } from '$app/navigation'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { pageQuery, homeSections } from '$lib/anilist/queries'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import ContinueRow from '$lib/components/cards/ContinueRow.svelte'
  import Hero from '$lib/components/banner/Hero.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken, malUser } from '$lib/trackers/config'
  import { isMobile } from '$lib/platform'
  import { offlineMode } from '$lib/stores/offline'
  import DownloadedLibrary from '$lib/components/offline/DownloadedLibrary.svelte'
  import * as h from '$lib/haptics'
  import { effectiveNav, NAV_META } from '$lib/settings/nav'
  import type { Media } from '$lib/anilist/types'

  const client = getContextClient()
  const sections = homeSections(new Date())

  // Top-bar icons come from the nav config (items the user placed 'top').
  const topNav = $derived($effectiveNav.filter((c) => c.placement === 'top'))

  // Personalized rows use the connected AniList account name (from OAuth) if present,
  // otherwise the manually-entered username.
  const listUser = $derived($anilistUserName || $anilistUser)

  // The hero query doubles as the page's health canary. Rate limits (429) are retried
  // INSIDE the AniList client, so the store stays `fetching` (→ skeleton) and never lands
  // in an error state — only HARD failures do (API disabled/5xx/network). On such a failure
  // we show one page-level error + Try again instead of an army of empty rows / a hero that
  // skeleton-loads forever.
  type HeroResult = { fetching: boolean; error?: { message: string }; data?: { Page: { media: Media[] } } }

  // Bumping `retryKey` remounts the row components (each owns its own query → refetch);
  // reassigning `heroStore` refetches the hero. Together = a full homepage retry.
  let retryKey = $state(0)
  let heroStore = $state(makeHeroStore())
  let hero = $state<HeroResult>({ fetching: true })

  function makeHeroStore() {
    return queryStore<{ Page: { media: Media[] } }>({
      client,
      query: pageQuery(),
      variables: { perPage: 15, sort: ['TRENDING_DESC'] },
    })
  }

  // Re-subscribe whenever the hero store is recreated (on retry). The subscribe's
  // unsubscriber becomes the effect's teardown, so the old store is dropped first.
  // Skip the trending query entirely in offline mode (the offline branch never renders the hero).
  $effect(() => {
    if ($offlineMode) return
    return heroStore.subscribe((v) => (hero = v as HeroResult))
  })

  const heroMedias = $derived.by(() => {
    const all = hero.data?.Page.media ?? []
    const withBanner = all.filter((m) => m.bannerImage)
    return (withBanner.length ? withBanner : all).slice(0, 7)
  })

  // Hard failure = errored with nothing cached to show.
  const failed = $derived(!!hero.error && !hero.data)

  function retry() {
    heroStore = makeHeroStore()
    retryKey++
  }
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
      <img src="/brand/izumi-wordmark-white.svg" alt="izumi" class="h-5" draggable="false" />
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

{#if $offlineMode}
  <!-- Offline: local-first Continue Watching + the downloaded-series library. No network fired. -->
  <div class="space-y-4 pb-16 pt-2">
    {#key listUser}
      <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
    {/key}
    <DownloadedLibrary />
  </div>
{:else if failed}
  <div class="grid min-h-[60vh] place-items-center p-8 text-center">
    <div class="max-w-md">
      <h2 class="mb-2 text-lg font-black">Couldn't reach AniList</h2>
      <p class="mb-5 text-sm text-muted-foreground">
        {hero.error?.message || 'AniList is unavailable right now. This is usually temporary.'}
      </p>
      <button data-focusable onclick={retry}
        class="rounded-md bg-secondary px-4 py-2 text-sm font-bold hover:bg-accent">
        Try again
      </button>
    </div>
  </div>
{:else}
  <div class="pb-16">
    {#if heroMedias.length}
      <Hero medias={heroMedias} onplay={(m) => goto(`/app/anime/${m.id}`)} oninfo={(m) => goto(`/app/anime/${m.id}`)} />
    {:else}
      <div class="mb-6 h-[42vh] w-full animate-pulse bg-muted"></div>
    {/if}

    {#key retryKey}
      <!-- Unified resume row: AniList CURRENT + MAL watching + on-device local history merged into
           one carousel of landscape resume cards. Always rendered (auto-hides when empty) so it
           works from local history alone, with no tracker linked. -->
      {#key listUser}
        <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken || !!$malUser} />
      {/key}
      {#if listUser}
        {#key listUser}
          <ListRow title="Your List" userName={listUser} status="PLANNING" />
        {/key}
      {/if}
      <!-- MAL-sourced "plan to watch" for MAL-primary users (auto-hides when empty, so
           it doesn't duplicate the AniList row for single-tracker users). -->
      {#if $malToken || $malUser}
        <MalListRow title="Your List" status="plan_to_watch" />
      {/if}

      {#each sections as s (s.key)}
        <HomeRow title={s.title} vars={s.vars} />
      {/each}
    {/key}
  </div>
{/if}
