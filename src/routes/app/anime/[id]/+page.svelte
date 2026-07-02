<script lang="ts">
  import { page } from '$app/state'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
  import Hero from '$lib/components/banner/Hero.svelte'
  import Tabs from '$lib/components/detail/Tabs.svelte'
  import EpisodeList from '$lib/components/detail/EpisodeList.svelte'
  import { format, status, season } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import { playEpisode, type PlayState } from '$lib/stremio/play'

  const client = getContextClient()
  const id = Number(page.params.id)
  const store = queryStore<{ Media: Media }>({ client, query: MEDIA_BY_ID, variables: { id } })
  let active = $state('Episodes')
  let heroPlay = $state<PlayState>({ status: 'idle' })

  const fmtDate = (d?: { year?: number; month?: number; day?: number } | null) =>
    d?.year ? [d.year, d.month, d.day].filter(Boolean).join('-') : ''
</script>

{#if $store.fetching}
  <div class="h-[42vh] w-full animate-pulse bg-muted"></div>
{:else if $store.error}
  <div class="p-8 text-muted-foreground">Failed to load: {$store.error.message}</div>
{:else if $store.data?.Media}
  {@const m = $store.data.Media}
  <Hero media={m} onplay={() => playEpisode(m.id, 1, (s) => (heroPlay = s))} />
  <div class="px-8 pb-16">
    {#if heroPlay.status === 'resolving'}
      <p class="mb-3 text-sm text-muted-foreground">Resolving stream…</p>
    {:else if heroPlay.status === 'error'}
      <p class="mb-3 text-sm text-destructive">{heroPlay.message}</p>
    {/if}
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{format(m)}</span><span>·</span><span>{status(m)}</span><span>·</span>
      <span>{m.episodes ?? '?'} eps</span><span>·</span><span>{season(m)}</span>
      {#if m.averageScore}<span>·</span><span>{m.averageScore}%</span>{/if}
    </div>
    {#if m.genres?.length}
      <div class="mb-4 flex flex-wrap gap-2">
        {#each m.genres as g (g)}<span class="rounded-full bg-secondary px-3 py-1 text-xs">{g}</span>{/each}
      </div>
    {/if}
    <Tabs tabs={['Episodes', 'Details']} bind:active />
    {#if active === 'Episodes'}
      <EpisodeList count={m.episodes ?? 0} mediaId={m.id} />
    {:else}
      <div class="max-w-3xl space-y-4">
        {#if m.description}
          <p class="whitespace-pre-line text-sm text-muted-foreground">{m.description.replace(/<[^>]+>/g, '')}</p>
        {/if}
        <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {#if m.studios?.nodes?.length}
            <div><dt class="font-bold">Studios</dt><dd class="text-muted-foreground">{m.studios.nodes.map((s) => s.name).join(', ')}</dd></div>
          {/if}
          {#if fmtDate(m.startDate)}
            <div><dt class="font-bold">Start Date</dt><dd class="text-muted-foreground">{fmtDate(m.startDate)}</dd></div>
          {/if}
          {#if m.synonyms?.length}
            <div class="sm:col-span-2"><dt class="font-bold">Synonyms</dt><dd class="text-muted-foreground">{m.synonyms.join(' · ')}</dd></div>
          {/if}
        </dl>
      </div>
    {/if}
  </div>
{:else}
  <div class="p-8 text-muted-foreground">Not found.</div>
{/if}
