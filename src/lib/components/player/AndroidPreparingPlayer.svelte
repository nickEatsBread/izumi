<script lang="ts">
  import { goto } from '$app/navigation'
  import type { Media } from '$lib/anilist/types'
  import { airedCount, banner, cover, mediaHref, title, totalEpisodes } from '$lib/anilist/media'
  import { connecting, streamPicker } from '$lib/player/session'
  import { mpvState } from '$lib/player/android-mpv'
  import { requestAndroidRelated } from '$lib/player/android-watch-navigation'
  import { cancelResolve, playEpisode } from '$lib/stremio/play'
  import AndroidWatchDetails from './AndroidWatchDetails.svelte'

  let {
    media,
    episode,
    active = false,
    mini = false,
  }: {
    media: Media
    episode: number | null | undefined
    active?: boolean
    mini?: boolean
  } = $props()

  const total = $derived(totalEpisodes(media) || null)
  const aired = $derived.by(() => {
    const value = airedCount(media)
    return Number.isFinite(value) ? value : 0
  })
  const hasPrev = $derived(episode != null && episode > 1)
  const hasNext = $derived(episode != null && episode < aired)
  const art = $derived(banner(media) || cover(media))

  function play(target: number) {
    if (target < 1 || target > aired) return
    void playEpisode(media, target, () => {}, { autoplay: active ? !$mpvState.paused : true })
  }
  async function openRelated(target: Media) {
    if (active && requestAndroidRelated(mediaHref(target))) return
    cancelResolve()
    connecting.set(null)
    streamPicker.set(null)
    await goto(mediaHref(target))
  }
</script>

<!-- The Android player page can be useful before a byte of video is ready. Artwork occupies the
     future native-video rectangle while comments, episode metadata and relations start below it. -->
<div class="android-preparing fixed inset-0 z-40 overflow-hidden text-white" class:active class:hidden={mini}>
  <section class="preparing-video relative overflow-hidden">
    {#if !active && art}
      <img src={art} alt="" class="absolute inset-0 h-full w-full scale-[1.03] object-cover opacity-60" />
    {/if}
    {#if !active}
      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/35"></div>
      <div class="absolute inset-x-0 bottom-[4.25rem] px-4 drop-shadow-lg">
        <h1 class="line-clamp-1 text-lg font-extrabold">{title(media)}</h1>
        {#if episode != null}<p class="mt-0.5 text-xs font-semibold text-white/65">Episode {episode}{total ? ` of ${total}` : ''}</p>{/if}
      </div>
    {/if}
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
    background: #111214;
  }
  .preparing-details {
    height: calc(100% - env(safe-area-inset-top) - 56.25vw);
    touch-action: pan-y;
    background: #0a0a0b;
  }
  .android-preparing { background: #0a0a0b; }
  .android-preparing.active { background: transparent; }
  .android-preparing.active .preparing-video { background: transparent; pointer-events: none; }
  @media (orientation: landscape) {
    .preparing-video { height: 100%; margin-top: 0; }
    .preparing-details { display: none; }
  }
</style>
