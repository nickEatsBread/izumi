<script lang="ts">
  import ThemeCard from './ThemeCard.svelte'
  import ThemeFeatured from './ThemeFeatured.svelte'
  import { platformFor, type ThemePlatform } from '$lib/themes/packages'
  import { isMobile } from '$lib/platform'
  import { shelvesFor } from '$lib/themes/store-shelves'
  import type { ThemeListing } from '$lib/store/themes'

  let { listings, filtered, official, installed, note, onopen }: {
    listings: ThemeListing[]
    /** A search is on: one results grid instead of the storefront. */
    filtered: boolean
    official: string
    installed: (listing: ThemeListing) => boolean
    note: (listing: ThemeListing) => string
    onopen: (listing: ThemeListing) => void
  } = $props()
  const featured = $derived(listings.filter((item) => item.release.screenshots?.length && !note(item)).slice(0, 6))
  const shelves = $derived(shelvesFor(listings, official))
  // Screenshots follow the device: desktop shots on desktop, phone shots on phones.
  const shown = (listing: ThemeListing): ThemePlatform => platformFor(listing.release, $isMobile ? 'phone' : 'desktop')
</script>

{#snippet card(listing: ThemeListing)}
  <ThemeCard {listing} platform={shown(listing)} installed={installed(listing)} note={note(listing)} storeName={listing.origin === official ? '' : listing.storeName} {onopen} />
{/snippet}

{#if filtered}
  <div data-nav-row data-nav-row-wrap><div class="grid" data-nav-row-items>{#each listings as listing (`${listing.origin}|${listing.release.id}`)}{@render card(listing)}{/each}</div></div>
{:else}
  <ThemeFeatured listings={featured} {onopen} />
  {#each shelves as shelf (shelf.id)}
    <!-- Big cards, two to a row: each screenshot is wide enough to actually read. -->
    <section class="shelf" data-nav-row data-nav-row-wrap aria-labelledby={`theme-shelf-${shelf.id}`}>
      <h3 id={`theme-shelf-${shelf.id}`}>{shelf.title}</h3>
      <div class="grid" data-nav-row-items>{#each shelf.listings as listing (`${listing.origin}|${listing.release.id}`)}{@render card(listing)}{/each}</div>
    </section>
  {/each}
{/if}

<style>
  .shelf { margin-top: 40px; }
  h3 { margin: 0 0 12px; font-size: 20px; font-weight: 900; letter-spacing: -.02em; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 16px; }
  @container (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
</style>
