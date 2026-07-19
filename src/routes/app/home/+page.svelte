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
  import { anilistUserName, malToken } from '$lib/trackers/config'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import Search from 'lucide-svelte/icons/search'
  import type { Media } from '$lib/anilist/types'

  const client = getContextClient()
  const sections = homeSections(new Date())

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
  $effect(() => heroStore.subscribe((v) => (hero = v as HeroResult)))

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

{#if failed}
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
  {#if $isMobile}
    <!-- Top app bar: brand mark left, search right, over a downward scrim so both stay legible on
         top of the hero art (Crunchyroll/AniStation style). The bar passes touches through except
         its two controls, so the hero underneath stays swipeable. -->
    <div class="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-background/90 via-background/40 to-transparent px-4 pb-8 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <img src="/brand/izumi-mark-color.svg" alt="izumi" class="pointer-events-auto h-7 w-7" draggable="false" />
      <a href="/app/search" data-focusable aria-label="Search" onclick={() => h.tap()}
         class="pointer-events-auto grid size-9 place-items-center rounded-full text-foreground transition-colors active:bg-white/10">
        <Search size={22} />
      </a>
    </div>
  {/if}
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
        <ContinueRow title="Continue Watching" userName={listUser} malActive={!!$malToken} />
      {/key}
      {#if listUser}
        {#key listUser}
          <ListRow title="Your List" userName={listUser} status="PLANNING" />
        {/key}
      {/if}
      <!-- MAL-sourced "plan to watch" for MAL-primary users (auto-hides when empty, so
           it doesn't duplicate the AniList row for single-tracker users). -->
      {#if $malToken}
        <MalListRow title="Your List" status="plan_to_watch" />
      {/if}

      {#each sections as s (s.key)}
        <HomeRow title={s.title} vars={s.vars} />
      {/each}
    {/key}
  </div>
{/if}
