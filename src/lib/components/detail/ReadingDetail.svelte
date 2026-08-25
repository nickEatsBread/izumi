<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { READING_MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import { descriptionText } from '$lib/anilist/description'
  import type { Media } from '$lib/anilist/types'
  import { banner, cover, format, status, title } from '$lib/anilist/media'
  import Tabs from './Tabs.svelte'
  import RichMetadata from './RichMetadata.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import BookOpen from '@lucide/svelte/icons/book-open'
  import MediaTagList from './MediaTagList.svelte'

  let { id }: { id: number } = $props()
  const client = getContextClient()
  const store = $derived(queryStore({
    client,
    query: READING_MEDIA_BY_ID,
    variables: { id },
  }))
  const media = $derived($store.data?.Media as Media | null | undefined)
  let active = $state('Overview')

  const enumLabel = (value?: string) =>
    value ? value.replaceAll('_', ' ').toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : ''
</script>

{#if $store.fetching}
  <div class="p-4 sm:p-8">
    <div class="h-72 animate-pulse rounded-2xl bg-muted"></div>
    <div class="mt-6 h-8 w-64 animate-pulse rounded bg-muted"></div>
    <div class="mt-3 h-24 max-w-4xl animate-pulse rounded bg-muted"></div>
  </div>
{:else if $store.error || !media}
  <div class="grid min-h-[65vh] place-items-center p-6 text-center">
    <div>
      <h1 class="text-2xl font-black">Title unavailable</h1>
      <p class="mt-2 text-sm text-muted-foreground">This manga or novel could not be loaded from AniList.</p>
    </div>
  </div>
{:else}
  {@const m = media}
  {@const novel = m.format === 'NOVEL'}
  <div class="pb-20">
    <section class="relative isolate min-h-[22rem] overflow-hidden border-b border-border">
      <img src={banner(m)} alt="" class="absolute inset-0 -z-20 h-full w-full object-cover opacity-40 blur-sm scale-105" />
      <div class="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/90 to-background/55"></div>
      <div class="absolute inset-0 -z-10 bg-gradient-to-t from-background via-transparent to-background/25"></div>

      <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-end sm:px-8 sm:py-10">
        <img src={cover(m)} alt={title(m)} class="aspect-[2/3] w-36 shrink-0 rounded-xl bg-muted object-cover shadow-2xl sm:w-48" />
        <div class="min-w-0 max-w-3xl">
          <div class="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-background/75 px-3 py-1 text-xs font-black backdrop-blur">
            <BookOpen size={14} />
            {novel ? 'Novel information' : 'Manga information'} only
          </div>
          <h1 class="text-3xl font-black leading-tight sm:text-5xl">{title(m)}</h1>
          {#if m.title.native && m.title.native !== title(m)}
            <p class="mt-1 text-sm text-muted-foreground">{m.title.native}</p>
          {/if}
          <div class="mt-4 flex flex-wrap gap-2 text-xs font-bold">
            {#if format(m)}<span class="rounded-full bg-secondary px-3 py-1">{format(m)}</span>{/if}
            {#if status(m)}<span class="rounded-full bg-secondary px-3 py-1">{status(m)}</span>{/if}
            {#if m.startDate?.year}<span class="rounded-full bg-secondary px-3 py-1">{m.startDate.year}</span>{/if}
            {#if m.averageScore}<span class="rounded-full bg-secondary px-3 py-1">{m.averageScore}%</span>{/if}
          </div>
          <p class="mt-4 max-w-2xl text-sm text-muted-foreground">
            Izumi displays tracker metadata for this title, but does not provide reading, chapters, downloads, or source resolution.
          </p>
          <div class="mt-5 flex flex-wrap gap-2">
            <button data-focusable onclick={() => openUrl(`https://anilist.co/manga/${m.id}`)}
              class="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-black text-primary-foreground">
              AniList <ExternalLink size={14} />
            </button>
            {#if m.idMal}
              <button data-focusable onclick={() => openUrl(`https://myanimelist.net/manga/${m.idMal}`)}
                class="inline-flex items-center gap-1.5 rounded-md bg-secondary px-4 py-2 text-sm font-black">
                MyAnimeList <ExternalLink size={14} />
              </button>
            {/if}
          </div>
        </div>
      </div>
    </section>

    <div class="mx-auto max-w-6xl px-4 pt-6 sm:px-8">
      <Tabs tabs={['Overview', 'Relations', 'Characters & Staff', 'Recommended']} bind:active />

      {#if active === 'Overview'}
        <div class="grid gap-8 pt-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section>
            <h2 class="mb-3 text-lg font-black">Synopsis</h2>
            <p class="whitespace-pre-line text-sm leading-7 text-muted-foreground">
              {descriptionText(m.description) || 'No synopsis is available.'}
            </p>
            {#if m.genres?.length}
              <div class="mt-6 flex flex-wrap gap-2">
                {#each m.genres as genre}
                  <a data-focusable href={`/app/search?genre=${encodeURIComponent(genre)}`} class="rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-bold hover:bg-accent">{genre}</a>
                {/each}
              </div>
            {/if}
            {#if m.tags?.length}
              <div class="mt-6">
                <h3 class="mb-2 text-sm font-black">Tags</h3>
                <MediaTagList tags={m.tags} showRank />
              </div>
            {/if}
          </section>

          <aside class="h-fit rounded-xl border border-border bg-card/70 p-4">
            <h2 class="mb-3 font-black">Publication</h2>
            <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt class="text-muted-foreground">Format</dt><dd class="text-right font-bold">{format(m) || 'Unknown'}</dd>
              <dt class="text-muted-foreground">Status</dt><dd class="text-right font-bold">{status(m) || 'Unknown'}</dd>
              <dt class="text-muted-foreground">Chapters</dt><dd class="text-right font-bold">{m.chapters || 'Unknown'}</dd>
              <dt class="text-muted-foreground">Volumes</dt><dd class="text-right font-bold">{m.volumes || 'Unknown'}</dd>
              <dt class="text-muted-foreground">Started</dt><dd class="text-right font-bold">{m.startDate?.year || 'Unknown'}</dd>
              {#if m.countryOfOrigin}
                <dt class="text-muted-foreground">Country</dt><dd class="text-right font-bold">{m.countryOfOrigin}</dd>
              {/if}
              {#if m.source}
                <dt class="text-muted-foreground">Source</dt><dd class="text-right font-bold">{enumLabel(m.source)}</dd>
              {/if}
              <dt class="text-muted-foreground">Popularity</dt><dd class="text-right font-bold">{m.popularity?.toLocaleString() || 'Unknown'}</dd>
            </dl>
          </aside>
        </div>
      {:else if active === 'Relations'}
        {#if m.relations?.edges?.length}
          <div class="flex flex-wrap gap-4 pt-5">
            {#each m.relations.edges as relation (`${relation.relationType}-${relation.node.id}`)}
              <div class="w-28 sm:w-[152px]">
                <div class="mb-1 text-[0.65rem] uppercase text-muted-foreground">{enumLabel(relation.relationType)}</div>
                <SmallCard media={relation.node} />
              </div>
            {/each}
          </div>
        {:else}
          <p class="pt-5 text-muted-foreground">No related titles.</p>
        {/if}
      {:else if active === 'Characters & Staff'}
        <div class="pt-5"><RichMetadata media={m} view="people" /></div>
      {:else}
        <div class="pt-5"><RichMetadata media={m} view="recommendations" /></div>
      {/if}
    </div>
  </div>
{/if}
