<script lang="ts">
  // Episode rail for a theme's docked watch layout. Beside the stage it is a scrolling list of
  // episode cards; below it, a server switcher followed by an episode number grid. Picking an
  // episode takes the Next button's route (same release continues without the picker when it is
  // cached); switching a server swaps the stream in place at the current position.
  import { tick } from 'svelte'
  import { nowPlaying, nowPlayingMedia, playbackRecovery, playerNotice } from '$lib/player/session'
  import { playEpisodeInPlayer, playStream } from '$lib/stremio/play'
  import { playerGetProperty } from '$lib/player/native'
  import { positions, progressKey } from '$lib/player/progress'
  import { animeEpisodeNumbers, animeEpisodeMetadata } from '$lib/catalog/anime-detail'
  import { anilistIdOf } from '$lib/catalog/identity'
  import { getEpisodeMeta } from '$lib/anizip'
  import type { EpMeta } from '$lib/anizip/types'
  import { airedCount, title } from '$lib/anilist/media'
  import { serverSiblings, variantLabels } from '$lib/player/source-variants'
  import type { Stream } from '$lib/stremio/addon'
  import Play from '@lucide/svelte/icons/play'

  // `scroll`: the list scrolls on its own (side rail). Off when a shared scroller holds it together
  // with the discussion under the stage.
  let { orientation = 'right', scroll = true }: { orientation?: 'right' | 'below'; scroll?: boolean } = $props()

  const context = $derived($nowPlayingMedia)
  const media = $derived(context?.media ?? null)
  const current = $derived($nowPlaying.episode ?? context?.episode ?? null)
  const aired = $derived(media ? airedCount(media) : 0)
  const numbers = $derived(media ? animeEpisodeNumbers(media).filter((n) => aired <= 0 || n <= aired) : [])

  // Titles and stills: the catalogue's own episode records first, AniZip layered over them.
  let meta = $state<Record<number, EpMeta>>({})
  $effect(() => {
    const m = media
    meta = m ? animeEpisodeMetadata(m) : {}
    const id = m ? anilistIdOf(m) : undefined
    if (!m || !id) return
    let live = true
    const merge = (next: Record<number, EpMeta>) => { if (live) meta = { ...meta, ...next } }
    getEpisodeMeta(id, undefined, merge).then(merge).catch(() => {})
    return () => { live = false }
  })

  const progress = (n: number) => {
    const p = media ? $positions[progressKey(media.id, n)] : undefined
    return p && p.dur > 0 ? Math.min(100, (p.pos / p.dur) * 100) : 0
  }

  // Sibling servers this site resolved for the same episode (the pool kept for watchdog recovery).
  const recovery = $derived($playbackRecovery)
  const currentStream = $derived(recovery?.current ?? null)
  const servers = $derived(currentStream ? [currentStream, ...serverSiblings(currentStream, recovery?.streams ?? [])] : [])
  const serverLabels = $derived(variantLabels(servers))

  let busy = $state(false)
  async function pick(n: number) {
    if (!media || busy || n === current) return
    busy = true
    try { await playEpisodeInPlayer(media, n) } finally { busy = false }
  }
  async function swap(target: Stream) {
    if (!context || busy || target === currentStream) return
    busy = true
    const startSeconds = Number(await playerGetProperty('time-pos').catch(() => '0')) || 0
    await playStream(context.media, context.episode, target, (s) => {
      if (s.status === 'error') playerNotice.set(s.message ?? 'Could not switch source.')
    }, { autoplay: true, startSeconds })
    busy = false
  }

  // Keep the playing episode in view as it changes (auto-advance included).
  let list = $state<HTMLElement | undefined>(undefined)
  $effect(() => {
    void current
    void tick().then(() => list?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }))
  })
</script>

<div class="flex flex-col {scroll ? 'h-full min-h-0' : ''}" data-dock-episodes={orientation} aria-busy={busy}>
  <header class="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
    <h2 class="truncate text-sm font-black">{media ? title(media) : 'Episodes'}</h2>
    <span class="shrink-0 text-xs font-bold text-muted-foreground">{numbers.length} episodes</span>
  </header>
  {#if servers.length > 1}
    <div class="flex flex-wrap items-center gap-1.5 px-4 pb-2" role="group" aria-label="Server">
      <span class="text-[0.65rem] font-black uppercase tracking-wide text-muted-foreground">Server</span>
      {#each servers as server, index (index)}
        <button type="button" data-focusable disabled={busy} onclick={() => swap(server)} aria-pressed={server === currentStream}
                class="rounded-full px-2.5 py-1 text-xs font-bold transition-colors {server === currentStream ? 'bg-theme text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}">
          {serverLabels[index]}
        </button>
      {/each}
    </div>
  {/if}
  <div bind:this={list} class="px-3 pb-4 {scroll ? 'min-h-0 flex-1 overflow-y-auto' : ''}">
    {#if orientation === 'right'}
      <ol class="flex flex-col gap-1">
        {#each numbers as n (n)}
          {@const on = n === current}
          <li>
            <button type="button" data-focusable disabled={busy} onclick={() => pick(n)} aria-current={on ? 'true' : undefined}
                    class="group flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors {on ? 'bg-theme/15' : 'hover:bg-secondary'}">
              <span class="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-secondary">
                {#if meta[n]?.image}<img src={meta[n].image} alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />{/if}
                {#if on}<span class="absolute inset-0 grid place-items-center bg-black/45 text-white"><Play size={16} fill="currentColor" /></span>{/if}
                {#if progress(n) > 0}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-white/30"><span class="block h-full bg-theme" style:width={`${progress(n)}%`}></span></span>{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[0.65rem] font-black uppercase tracking-wide {on ? 'text-theme' : 'text-muted-foreground'}">Episode {n}</span>
                <span class="line-clamp-2 text-xs font-semibold leading-snug {on ? 'text-foreground' : 'text-foreground/85'}">{meta[n]?.title ?? `Episode ${n}`}</span>
              </span>
            </button>
          </li>
        {/each}
      </ol>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5">
        {#each numbers as n (n)}
          {@const on = n === current}
          <button type="button" data-focusable disabled={busy} onclick={() => pick(n)} aria-current={on ? 'true' : undefined}
                  class="relative h-9 overflow-hidden rounded-md text-xs font-black tabular-nums transition-colors {on ? 'bg-theme text-background' : 'bg-secondary text-foreground/85 hover:bg-secondary/70'}">
            {n}
            {#if !on && progress(n) > 0}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-white/20"><span class="block h-full bg-theme" style:width={`${progress(n)}%`}></span></span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
