<script lang="ts">
  // Episode switcher over the desktop player (Player buttons › Episodes, or the right-click menu): a
  // compact numbered list where the playing episode opens up with its still. Picking one takes the
  // dock rail's route (`playEpisodeInPlayer`, the Next button's path), so playback never leaves the
  // player. Same data as DockEpisodes: the catalogue's episode records with AniZip layered over.
  import { tick } from 'svelte'
  import { nowPlaying, nowPlayingMedia } from '$lib/player/session'
  import { playEpisodeInPlayer } from '$lib/stremio/play'
  import { positions, progressKey } from '$lib/player/progress'
  import { animeEpisodeNumbers, animeEpisodeMetadata } from '$lib/catalog/anime-detail'
  import { anilistIdOf } from '$lib/catalog/identity'
  import { getEpisodeMeta } from '$lib/anizip'
  import type { EpMeta } from '$lib/anizip/types'
  import { airedCount, title } from '$lib/anilist/media'
  import Play from '@lucide/svelte/icons/play'

  let { onclose }: { onclose: () => void } = $props()

  const context = $derived($nowPlayingMedia)
  const media = $derived(context?.media ?? null)
  const current = $derived($nowPlaying.episode ?? context?.episode ?? null)
  const aired = $derived(media ? airedCount(media) : 0)
  const numbers = $derived(media ? animeEpisodeNumbers(media).filter((n) => aired <= 0 || n <= aired) : [])

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

  let busy = $state(false)
  async function pick(n: number) {
    if (!media || busy) return
    if (n === current) { onclose(); return }
    busy = true
    onclose()
    try { await playEpisodeInPlayer(media, n) } finally { busy = false }
  }

  let list = $state<HTMLElement | undefined>(undefined)
  $effect(() => {
    void current
    void tick().then(() => list?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'center' }))
  })
</script>

<button type="button" tabindex="-1" class="pointer-events-auto fixed inset-0 z-20 cursor-default" onclick={onclose} aria-label="Close episodes"></button>
<div data-player-episodes role="dialog" aria-label="Episodes"
     class="pointer-events-auto absolute bottom-full right-0 z-30 mb-2 flex max-h-[min(60vh,32rem)] w-[26rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-sm text-white shadow-2xl [transform:translateZ(0)] [will-change:transform]">
  <header class="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
    <h2 class="truncate text-base font-bold">{media ? title(media) : 'Episodes'}</h2>
    <span class="shrink-0 text-xs text-white/50">{numbers.length} episodes</span>
  </header>
  <ol bind:this={list} class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
    {#each numbers as n (n)}
      {@const on = n === current}
      {@const watched = progress(n)}
      <li>
        <button type="button" data-focusable disabled={busy} onclick={() => pick(n)} aria-current={on ? 'true' : undefined}
                class="flex w-full gap-3 rounded-lg px-2 text-left transition-colors {on ? 'items-start bg-white/10 py-2' : 'items-center py-1.5 text-white/80 hover:bg-white/10 hover:text-white'}">
          <span class="w-6 shrink-0 text-center tabular-nums {on ? 'pt-0.5 font-bold' : 'text-white/50'}">{n}</span>
          {#if on}
            <span class="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-white/10">
              {#if meta[n]?.image}<img src={meta[n].image} alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />{/if}
              <span class="absolute inset-0 grid place-items-center bg-black/40"><Play size={18} fill="currentColor" /></span>
              {#if watched > 0}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-white/30"><span class="block h-full bg-white" style:width={`${watched}%`}></span></span>{/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="line-clamp-2 font-semibold leading-snug">{meta[n]?.title ?? `Episode ${n}`}</span>
              <span class="mt-0.5 block text-xs text-white/55">Now playing</span>
            </span>
          {:else}
            <span class="min-w-0 flex-1 truncate">{meta[n]?.title ?? `Episode ${n}`}</span>
            {#if watched > 0}<span class="h-0.5 w-12 shrink-0 bg-white/20"><span class="block h-full bg-white/80" style:width={`${watched}%`}></span></span>{/if}
          {/if}
        </button>
      </li>
    {/each}
  </ol>
</div>
