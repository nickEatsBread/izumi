<script lang="ts">
  import { goto } from '$app/navigation'
  import type { Media } from '$lib/anilist/types'
  import { airedCount, banner, cover, mediaHref, title, totalEpisodes } from '$lib/anilist/media'
  import { connecting, streamPicker } from '$lib/player/session'
  import { cancelResolve, playEpisode } from '$lib/stremio/play'
  import AndroidWatchDetails from './AndroidWatchDetails.svelte'

  let { media, episode }: { media: Media; episode: number | null | undefined } = $props()

  const total = $derived(totalEpisodes(media) || null)
  const aired = $derived(airedCount(media))
  const hasPrev = $derived(episode != null && episode > 1)
  const hasNext = $derived(episode != null && episode < aired)
  const art = $derived(banner(media) || cover(media))

  function play(target: number) {
    if (target < 1 || target > aired) return
    void playEpisode(media, target, () => {})
  }
  async function openRelated(target: Media) {
    cancelResolve()
    connecting.set(null)
    streamPicker.set(null)
    await goto(mediaHref(target))
  }
</script>

<!-- The Android player page can be useful before a byte of video is ready. Artwork occupies the
     future native-video rectangle while comments, episode metadata and relations start below it. -->
<div class="android-preparing fixed inset-0 z-40 overflow-hidden bg-[#0a0a0b] text-white">
  <section class="preparing-video relative overflow-hidden bg-[#111214]">
    {#if art}
      <img src={art} alt="" class="absolute inset-0 h-full w-full scale-[1.03] object-cover opacity-60" />
    {/if}
    <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/35"></div>
    <div class="absolute inset-x-0 bottom-[4.25rem] px-4 drop-shadow-lg">
      <h1 class="line-clamp-1 text-lg font-extrabold">{title(media)}</h1>
      {#if episode != null}<p class="mt-0.5 text-xs font-semibold text-white/65">Episode {episode}{total ? ` of ${total}` : ''}</p>{/if}
    </div>
  </section>
  <section class="preparing-details overflow-y-auto overscroll-contain">
    <AndroidWatchDetails
      {media}
      episode={episode ?? null}
      {total}
      {hasPrev}
      {hasNext}
      onPrev={() => episode != null && play(episode - 1)}
      onNext={() => episode != null && play(episode + 1)}
      onRelated={openRelated}
    />
  </section>
</div>

<style>
  .preparing-video {
    height: 56.25vw;
    margin-top: env(safe-area-inset-top);
  }
  .preparing-details {
    height: calc(100% - env(safe-area-inset-top) - 56.25vw);
    touch-action: pan-y;
  }
  @media (orientation: landscape) {
    .preparing-video { height: 100%; margin-top: 0; }
    .preparing-details { display: none; }
  }
</style>
