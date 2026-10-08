<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import Quote from '@lucide/svelte/icons/quote'
  import Star from '@lucide/svelte/icons/star'
  import type { Media } from '$lib/anilist/types'
  import { banner, mediaHref, title } from '$lib/anilist/media'
  import { detailLink } from '$lib/anilist/detail-hint'

  let { media }: { media: Media } = $props()
</script>

<section class="px-4 sm:px-8">
  <a href={mediaHref(media)} use:detailLink={media} data-focusable class="group relative block min-h-[24rem] overflow-hidden rounded-2xl bg-[#111217] text-white shadow-xl ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[28rem]">
    {#if banner(media)}<img src={banner(media)} alt="" class="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.015]" />{/if}
    <span aria-hidden="true" class="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,8,12,.98)_0%,rgba(7,8,12,.88)_38%,rgba(7,8,12,.24)_72%,rgba(7,8,12,.08)_100%)]"></span>
    <span class="relative flex min-h-[24rem] max-w-2xl flex-col justify-end p-6 sm:min-h-[28rem] sm:p-10">
      <span class="mb-5 grid size-11 place-items-center rounded-full bg-orange-300/15 text-orange-300 ring-1 ring-orange-300/20"><Quote size={20} /></span>
      <span class="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Daily acclaimed pick</span>
      <span class="mt-2 block text-3xl font-black tracking-tight sm:text-5xl">{title(media)}</span>
      {#if media.description}<span class="mt-3 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">{media.description}</span>{/if}
      <span class="mt-5 flex flex-wrap items-center gap-3 text-sm font-bold text-white/75">
        {#if media.averageScore}<span class="inline-flex items-center gap-1.5"><Star size={15} class="fill-orange-300 text-orange-300" /> {media.averageScore}% TMDB community</span>{/if}
        {#if media.startDate?.year}<span>{media.startDate.year}</span>{/if}
        <span class="inline-flex items-center gap-1 text-white">Open details <ArrowUpRight size={15} /></span>
      </span>
    </span>
  </a>
</section>
