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
      <div class="relative flex w-[12.5rem] shrink-0 items-end sm:w-[13.5rem]" aria-label={`Number ${index + 1}`}>
        <span aria-hidden="true" class="pointer-events-none w-[5.25rem] shrink-0 select-none text-right text-[8.5rem] font-black leading-[0.78] tracking-[-0.12em] text-background [-webkit-text-stroke:2px_rgb(255_255_255_/_0.32)] sm:w-[5.75rem] sm:text-[9.5rem]">{index + 1}</span>
        <div class="relative -ml-2 w-32 shrink-0 sm:w-36">
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
