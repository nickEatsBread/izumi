<script lang="ts">
  import type { CatalogHomeSection } from '$lib/catalog/types'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import StreamingProviderRow from './StreamingProviderRow.svelte'

  let {
    section,
    title = section.title,
    viewMoreHref,
    showCatalogSource = true,
  }: {
    section: CatalogHomeSection
    title?: string
    viewMoreHref?: string
    showCatalogSource?: boolean
  } = $props()
</script>

{#if section.presentation === 'providers'}
  <StreamingProviderRow {section} {title} />
{:else}
<Carousel {title} {viewMoreHref} attribution={section.attribution}>
  {#if section.presentation === 'ranked'}
    {#each section.media as media, index (media.catalog?.id ?? media.id)}
      {@const position = index + 1}
      <div class="relative flex shrink-0 items-end {position > 9 ? 'w-[15.25rem] sm:w-[16.5rem]' : 'w-[12.75rem] sm:w-[13.75rem]'}" aria-label={`Number ${position}`}>
        <span
          aria-hidden="true"
          class="rank-number {position > 9 ? 'rank-number-wide w-[7.2rem] sm:w-[8rem]' : 'w-[5.2rem] sm:w-[5.8rem]'}"
        >{position}</span>
        <div class="relative z-10 -ml-1.5 w-32 shrink-0 sm:w-36">
          <SmallCard {media} fill simpleHover {showCatalogSource} />
        </div>
      </div>
    {/each}
  {:else}
    {#each section.media as media (media.catalog?.id ?? media.id)}
      <div class="shrink-0"><SmallCard {media} {showCatalogSource} /></div>
    {/each}
  {/if}
</Carousel>
{/if}

<style>
  .rank-number {
    pointer-events: none;
    display: flex;
    height: 12rem;
    flex-shrink: 0;
    align-items: flex-end;
    justify-content: flex-end;
    overflow: hidden;
    padding-bottom: .9rem;
    color: color-mix(in srgb, hsl(var(--foreground)) 19%, hsl(var(--background)));
    font-family: 'Nunito Variable', sans-serif;
    font-size: 10.75rem;
    font-weight: 950;
    font-variation-settings: 'wght' 950;
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1;
    letter-spacing: -.09em;
    line-height: .72;
    text-shadow: 0 10px 28px rgb(0 0 0 / .38);
    user-select: none;
  }
  .rank-number-wide {
    font-size: 9.4rem;
    letter-spacing: -.16em;
  }
  @media (min-width: 640px) {
    .rank-number { height: 13.25rem; font-size: 11.8rem; }
    .rank-number-wide { font-size: 10.35rem; }
  }
</style>
