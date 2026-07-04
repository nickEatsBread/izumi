<script lang="ts">
  import { goto } from '$app/navigation'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { pageQuery, homeSections } from '$lib/anilist/queries'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import ListRow from '$lib/components/cards/ListRow.svelte'
  import MalListRow from '$lib/components/cards/MalListRow.svelte'
  import Hero from '$lib/components/banner/Hero.svelte'
  import { anilistUser } from '$lib/anilist/account'
  import { anilistUserName, malToken } from '$lib/trackers/config'
  import type { Media } from '$lib/anilist/types'

  const client = getContextClient()
  const sections = homeSections(new Date())

  // Personalized rows use the connected AniList account name (from OAuth) if present,
  // otherwise the manually-entered username.
  const listUser = $derived($anilistUserName || $anilistUser)

  // Fetch several trending titles for the rotating hero; prefer ones with a banner.
  const heroStore = queryStore<{ Page: { media: Media[] } }>({
    client,
    query: pageQuery(),
    variables: { perPage: 15, sort: ['TRENDING_DESC'] },
  })
  const heroMedias = $derived.by(() => {
    const all = $heroStore.data?.Page.media ?? []
    const withBanner = all.filter((m) => m.bannerImage)
    return (withBanner.length ? withBanner : all).slice(0, 7)
  })
</script>

<div class="pb-16">
  {#if heroMedias.length}
    <Hero medias={heroMedias} onplay={(m) => goto(`/app/anime/${m.id}`)} oninfo={(m) => goto(`/app/anime/${m.id}`)} />
  {:else}
    <div class="mb-6 h-[42vh] w-full animate-pulse bg-muted"></div>
  {/if}

  {#if listUser}
    {#key listUser}
      <ListRow title="Continue Watching" userName={listUser} status="CURRENT" />
      <ListRow title="Your List" userName={listUser} status="PLANNING" />
    {/key}
  {/if}
  <!-- MAL-sourced rows for MAL-primary users (auto-hide when empty, so they don't
       duplicate the AniList rows for single-tracker users). -->
  {#if $malToken}
    <MalListRow title="Continue Watching" status="watching" />
    <MalListRow title="Your List" status="plan_to_watch" />
  {/if}

  {#each sections as s (s.key)}
    <HomeRow title={s.title} vars={s.vars} />
  {/each}
</div>
