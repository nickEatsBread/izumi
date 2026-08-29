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
        <svg
          aria-hidden="true"
          viewBox={position > 9 ? '0 0 176 190' : '0 0 112 190'}
          class="rank-number pointer-events-none h-[12rem] shrink-0 select-none overflow-visible sm:h-[13.25rem] {position > 9 ? 'w-[7.2rem] sm:w-[8rem]' : 'w-[5.2rem] sm:w-[5.8rem]'}"
          preserveAspectRatio="none"
        >
          <text x={position > 9 ? 172 : 108} y="174" text-anchor="end" vector-effect="non-scaling-stroke">{position}</text>
        </svg>
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
  .rank-number text {
    fill: color-mix(in srgb, hsl(var(--background)) 86%, hsl(var(--foreground)) 14%);
    stroke: color-mix(in srgb, hsl(var(--foreground)) 48%, transparent);
    stroke-width: 3;
    paint-order: stroke fill;
    font-family: Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', sans-serif;
    font-size: 180px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: -2px;
  }
</style>
