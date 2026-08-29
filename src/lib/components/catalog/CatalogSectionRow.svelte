<script lang="ts">
  import type { CatalogHomeSection } from '$lib/catalog/types'
  import Carousel from '$lib/components/cards/Carousel.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'

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
  {:else if section.presentation === 'collections'}
    {#each section.features ?? [] as feature (feature.id)}
      <a href={feature.href ?? '/app/search'} data-focusable draggable="false"
        class="group relative block aspect-[16/8.5] w-[min(78vw,30rem)] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-card shadow-lg">
        {#if feature.image}<img src={feature.image} alt="" draggable="false" loading="lazy" decoding="async" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />{/if}
        <span class="absolute inset-0 bg-gradient-to-t from-black/95 via-black/15 to-black/10"></span>
        {#if feature.subtitle}<span class="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wide text-white backdrop-blur">{feature.subtitle}</span>{/if}
        <span class="absolute inset-x-4 bottom-3 line-clamp-2 text-xl font-black text-white drop-shadow-lg sm:text-2xl">{feature.title}</span>
      </a>
    {/each}
  {:else if section.presentation === 'providers'}
    {#each section.features ?? [] as feature (feature.id)}
      <a href={feature.href ?? '/app/search'} data-focusable aria-label={`Browse ${feature.title}`}
        class="group flex h-28 w-44 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-secondary sm:w-52">
        {#if feature.image}<img src={feature.image} alt="" loading="lazy" decoding="async" class="size-14 rounded-xl object-cover shadow-md transition group-hover:scale-105" />{/if}
        <span class="max-w-full truncate text-xs font-black">{feature.title}</span>
      </a>
    {/each}
  {:else}
    {#each section.media as media (media.catalog?.id ?? media.id)}
      <div class="shrink-0"><SmallCard {media} {showCatalogSource} /></div>
    {/each}
  {/if}
</Carousel>
