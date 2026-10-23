<script lang="ts">
  import { untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { Media } from '$lib/anilist/types'
  import type { EpMeta } from '$lib/anizip/types'
  import { hideSpoilers } from '$lib/settings/ui'
  import { episodeName, loadEpisodeMeta } from '$lib/player/episode-info'

  let { media, episode, title }: { media?: Media; episode?: number; title: string } = $props()

  let meta = $state<EpMeta | undefined>()
  // Keyed on the title and episode, not the wrapper object: a source swap re-sets `nowPlayingMedia` for
  // the same episode and must not blank the lines while the lookup lands.
  const key = $derived(media && episode != null ? `${media.id}|${episode}` : '')
  $effect(() => {
    const k = key
    meta = undefined
    const target = untrack(() => media)
    if (!k || !target || episode == null) return
    return loadEpisodeMeta(target, episode, (next) => { meta = next })
  })
  const name = $derived(episode != null ? episodeName(episode, meta, $hideSpoilers) : undefined)
  const synopsis = $derived($hideSpoilers ? undefined : meta?.overview?.replace(/<[^>]*>/g, '').trim() || undefined)
</script>

<!-- "You're watching": shown over a paused video after five seconds without input (API 6 `player.paused`).
     Any input hides it. -->
<div data-part="player.summary" data-episode={episode} data-season={meta?.season || undefined}
     data-season-episode={meta?.season ? meta.seasonEpisode ?? episode : undefined}
     in:fade={{ duration: 250 }}
     class="izumi-hud pointer-events-none absolute inset-0 z-30 flex flex-col justify-center bg-black/50 px-[12%] text-white">
  <div data-part="player.summary.kicker" class="text-lg text-white/80">You're watching</div>
  <div data-part="player.summary.title" class="mt-1 text-5xl font-bold">{title}</div>
  {#if (meta?.season ?? 0) > 0}<div data-part="player.summary.season" class="mt-3 text-2xl font-semibold">Season {meta?.season}</div>{/if}
  {#if episode != null}<div data-part="player.summary.episode" class="mt-2 text-2xl font-semibold">{#if name}{`${name}: `}{/if}Ep. {episode}</div>{/if}
  {#if synopsis}<p data-part="player.summary.synopsis" class="mt-4 line-clamp-4 max-w-3xl text-lg text-white/80">{synopsis}</p>{/if}
  <div data-part="player.summary.state" class="absolute bottom-[12%] right-[12%] text-lg text-white/80">Paused</div>
</div>
