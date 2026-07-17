<script lang="ts">
  // A landscape "continue watching" card: the episode thumbnail with a resume badge
  // and an in-episode progress bar. Clicking it resolves + plays the next unwatched
  // episode straight away; the title links through to the detail page. `progress` is
  // the canonical watched-episode count (AniList or MyAnimeList), passed in so the
  // resume episode is right regardless of which tracker owns the show.
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { title as mediaTitle, cover, resumeEp } from '$lib/anilist/media'
  import { episodeSummary } from '$lib/anilist/episode-labels'
  import { getEpisodeMeta } from '$lib/anizip'
  import { positionPercent, positions, progressKey } from '$lib/player/progress'
  import { hideSpoilers } from '$lib/settings/ui'
  import { resumeEpisode, type PlayState } from '$lib/stremio/play'
  import type { Media } from '$lib/anilist/types'
  import type { EpMeta } from '$lib/anizip/types'
  import Play from 'lucide-svelte/icons/play'
  import Loader from 'lucide-svelte/icons/loader-circle'

  let { media, progress }: { media: Media; progress: number } = $props()

  const ep = $derived(resumeEp(media, progress))
  const name = $derived(mediaTitle(media))

  // Episode thumbnail (AniZip) for the resume episode; fall back to the banner/cover so
  // the card is never blank. Fetched once per media; `img` reacts to the resume episode.
  let meta = $state<Record<number, EpMeta>>({})
  onMount(async () => { try { meta = await getEpisodeMeta(media.id) } catch { /* fallback image */ } })
  const thumb = $derived(meta[ep]?.image || media.bannerImage || cover(media))
  const epTitle = $derived(meta[ep]?.title)
  const episodeLabel = $derived(episodeSummary(ep, epTitle, $hideSpoilers))

  // Subscribe to the persisted position map so this bar updates on the existing throttled player
  // saves. This adds no polling and no extra storage writes.
  const savedPosition = $derived($positions[progressKey(media.id, ep)])
  const pct = $derived(Math.round(positionPercent(savedPosition) * 100))

  let imgReady = $state(false)
  $effect(() => { void thumb; imgReady = false })

  let resolving = $state(false)
  // Prefer the last successful origin/release; if it is missing or fails, resumeEpisode opens the
  // complete source picker. Playback resumes from this episode's saved position either way.
  function play() { resumeEpisode(media, ep, (s: PlayState) => { resolving = s.status === 'resolving' }) }
</script>

<!-- ONE focusable (the card) = play. The cover is marked `.focus-cover` so controller/keyboard
     focus rings + pops the THUMBNAIL only (title stays put), matching SmallCard — the wrapper is
     NOT overflow-hidden so the ring isn't clipped. The title is a plain (non-focusable) link so
     the rail doesn't stop on it a second time; mouse users can still click it through to detail. -->
<div
  data-focusable
  role="button"
  tabindex="0"
  onclick={play}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() } }}
  title={`Resume — ${name} · Episode ${ep}`}
  class="group flex w-[264px] shrink-0 cursor-pointer flex-col text-left"
>
  <div class="focus-cover relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
    {#if !imgReady}<div class="absolute inset-0 skeloader"></div>{/if}
    {#if thumb}
      <img src={thumb} alt="" loading="lazy" decoding="async" onload={() => (imgReady = true)}
           class="h-full w-full transform-gpu object-cover transition-[opacity,transform] duration-500 group-hover:scale-105 {imgReady ? 'opacity-100' : 'opacity-0'}" />
    {/if}
    <div class="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>

    <span class="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-black">Ep {ep}</span>

    <!-- Center play affordance (hover), swapped for a spinner while a source resolves. -->
    <span class="absolute inset-0 grid place-items-center transition-opacity {resolving ? 'opacity-100' : 'opacity-90 sm:opacity-0 sm:group-hover:opacity-100'}">
      <span class="grid size-12 place-items-center rounded-full bg-white/90 text-black">
        {#if resolving}<Loader size={22} class="animate-spin" />{:else}<Play size={22} class="translate-x-0.5 fill-current" />{/if}
      </span>
    </span>

    {#if pct > 0}
      <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full bg-theme" style={`width:${pct}%`}></span></span>
    {/if}
  </div>

  <div class="mt-1.5">
    <a href={`/app/anime/${media.id}`} onclick={(e) => e.stopPropagation()}
       class="block truncate text-sm font-bold hover:text-theme">{name}</a>
    <span class="block truncate text-[0.7rem] text-muted-foreground">{episodeLabel}</span>
  </div>
</div>
