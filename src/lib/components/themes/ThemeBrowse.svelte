<script lang="ts">
  import ThemeCard from './ThemeCard.svelte'
  import ThemeFeatured from './ThemeFeatured.svelte'
  import { primaryPlatform, type ThemePlatform } from '$lib/themes/packages'
  import { shelvesFor } from '$lib/themes/store-shelves'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, filtered, official, platform, installed, note, onopen }: {
    listings: ThemeListing[]
    /** A search or platform filter is on: one results grid instead of the storefront. */
    filtered: boolean
    official: string
    platform: 'all' | ThemePlatform
    installed: (listing: ThemeListing) => boolean
    note: (listing: ThemeListing) => string
    onopen: (listing: ThemeListing) => void
  } = $props()
  const featured = $derived(listings.filter((item) => item.release.screenshots?.length && !note(item)).slice(0, 6))
  const shelves = $derived(shelvesFor(listings, official))
  const shown = (listing: ThemeListing): ThemePlatform => platform === 'all' ? primaryPlatform(listing.release) : platform
</script>

{#snippet card(listing: ThemeListing)}
  <ThemeCard {listing} platform={shown(listing)} installed={installed(listing)} note={note(listing)} storeName={listing.origin === official ? '' : listing.storeName} {onopen} />
{/snippet}

{#if filtered}
  <div data-nav-row data-nav-row-wrap><div class="grid" data-nav-row-items>{#each listings as listing (`${listing.origin}|${listing.release.id}`)}{@render card(listing)}{/each}</div></div>
{:else}
  <ThemeFeatured listings={featured} {onopen} />
  {#each shelves as shelf (shelf.id)}
    <section class="shelf" data-nav-row aria-labelledby={`theme-shelf-${shelf.id}`}>
      <h3 id={`theme-shelf-${shelf.id}`}>{shelf.title}</h3>
      <div class="track" data-nav-row-items data-nav-scroll-x>{#each shelf.listings as listing (`${listing.origin}|${listing.release.id}`)}{@render card(listing)}{/each}</div>
    </section>
  {/each}
{/if}

<style>
  .shelf { margin-top: 30px; }
  h3 { margin: 0 0 8px 8px; font-size: 19px; font-weight: 900; letter-spacing: -.02em; }
  .track { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 290px); gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 8px; padding-bottom: 8px; scrollbar-width: thin; }
  .track > :global(*) { scroll-snap-align: start; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 8px; }
  @media (max-width: 640px) { .track { grid-auto-columns: 80%; } }
</style>
