<script lang="ts">
  // A single rich episode card. When `showThumb`, a 16:9 AniZip thumbnail heads
  // the card; otherwise a compact text-forward layout. The outer element is a
  // div[role=button] (not <button>) so the nested Download button is valid HTML.
  import type { Media } from '$lib/anilist/types'
  import type { EpMeta } from '$lib/anizip/types'
  import type { DownloadItem } from '$lib/downloads/state'
  import { ratingBg } from '$lib/anilist/media'
  import { episodePercent } from '$lib/player/progress'
  import { hideSpoilers } from '$lib/settings/ui'
  import Download from 'lucide-svelte/icons/download'
  import Loader from 'lucide-svelte/icons/loader-circle'
  import Pause from 'lucide-svelte/icons/pause'
  import Check from 'lucide-svelte/icons/check'

  let {
    media, ep, meta, showThumb, released, isNext, filler = false, dl, next, onplay,
    selecting = false, selectedEp = false,
  }: {
    media: Media
    ep: number
    meta?: EpMeta
    showThumb: boolean
    released: boolean
    isNext: boolean
    filler?: boolean
    dl?: DownloadItem
    next?: { episode: number; timeUntilAiring: number } | null
    onplay: (ep: number) => void
    // Download select mode (driven by EpisodeList): a tap toggles selection instead of
    // playing, and the card shows a checkbox instead of the play affordance.
    selecting?: boolean
    selectedEp?: boolean
  } = $props()

  const img = $derived(meta?.image)
  // Progressive image: fade each thumbnail in when it decodes, with
  // a shimmer skeleton behind meanwhile — so thumbnails "come in over time" as they
  // download instead of the whole grid popping at once. Reset when the src changes.
  let imgReady = $state(false)
  $effect(() => { void img; imgReady = false })
  const epTitle = $derived(meta?.title || `Episode ${ep}`)
  const rating = $derived(typeof meta?.rating === 'number' ? Math.round(meta.rating * 10) : undefined)

  const trackedDone = $derived((media.mediaListEntry?.progress ?? 0) >= ep)
  const pct = $derived(released ? (trackedDone ? 100 : Math.round(episodePercent(media.id, ep) * 100)) : 0)
  const spoiler = $derived($hideSpoilers && released && !trackedDone && !isNext)

  const dlPct = $derived(dl && dl.bytes ? Math.round((dl.downloaded / dl.bytes) * 100) : 0)
  const dling = $derived(!!dl && (dl.status === 'downloading' || dl.status === 'paused') && !!dl.bytes)
  const dlTip = $derived(
    !dl || dl.status === 'error' ? (dl ? 'Download failed — retry' : 'Download')
    : dl.status === 'done' ? 'Downloaded'
    : dl.status === 'downloading' ? `Downloading ${dlPct}%`
    : dl.status === 'queued' ? 'Queued' : 'Paused',
  )

  function play() { if (released) onplay(ep) }
  function countdown(sec?: number) {
    if (!sec) return ''
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
</script>

{#snippet statusBadge(cls: string)}
  {#if selecting && released}
    <!-- Select mode: checkbox (the card tap toggles it — see EpisodeList). -->
    <span class="{cls} z-20 grid size-7 place-items-center rounded-full border-2 transition-colors
      {selectedEp ? 'border-theme bg-theme text-black' : 'border-white/80 bg-black/50 text-transparent'}">
      <Check size={15} />
    </span>
  {:else if dl}
    <!-- Read-only download status (the trigger now lives in EpisodeList's select mode). -->
    <span class="{cls} z-20 grid size-7 place-items-center rounded-full bg-black/70 text-white" title={dlTip}>
      {#if dl.status === 'error'}<Download size={14} class="text-destructive" />
      {:else if dl.status === 'queued'}<Loader size={14} class="animate-spin" />
      {:else if dl.status === 'downloading'}<span class="text-[0.55rem] font-black tabular-nums text-blue-300">{dlPct}</span>
      {:else if dl.status === 'paused'}<Pause size={13} class="text-amber-400" />
      {:else}<Check size={14} class="text-green-400" />{/if}
    </span>
  {/if}
{/snippet}

<div
  data-focusable
  role="button"
  tabindex="0"
  aria-disabled={!released}
  onclick={play}
  onkeydown={(e) => { if (released && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play() } }}
  title={selecting ? (released ? (selectedEp ? 'Selected — tap to unselect' : 'Tap to select') : 'Not yet aired') : released ? `Play — ${epTitle}` : isNext ? `Airing in ${countdown(next?.timeUntilAiring)}` : 'Not yet aired'}
  class="group flex flex-col overflow-hidden rounded-lg text-left
    {released ? 'cursor-pointer bg-secondary transition-transform hover:scale-[1.02] hover:bg-accent' : 'cursor-not-allowed bg-background/40 opacity-60'}
    {selecting && selectedEp ? 'ring-2 ring-theme' : ''}"
>
  {#if showThumb && img}
    <div class="relative aspect-video w-full overflow-hidden bg-muted">
      {#if !imgReady}<div class="absolute inset-0 skeloader"></div>{/if}
      <img src={img} alt="" loading="lazy" decoding="async" onload={() => (imgReady = true)}
           class:blur-lg={spoiler}
           class="h-full w-full object-cover transform-gpu will-change-transform transition-[opacity,transform] duration-500 {imgReady ? 'opacity-100' : 'opacity-0'} {released ? 'group-hover:scale-105' : 'grayscale'}" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>

      <span class="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-black">{ep}</span>

      <!-- Top-right corner: rating + download status packed together so a missing badge
           leaves NO gap (the rating used to be offset to clear a fixed download-icon slot). -->
      <div class="absolute right-2 top-2 flex items-center gap-1.5">
        {#if rating != null}
          <span class:blur-sm={spoiler} class="rounded px-1.5 py-0.5 text-[0.65rem] font-black text-white {ratingBg(rating)}">{rating}%</span>
        {/if}
        {@render statusBadge('')}
      </div>

      {#if filler}
        <span class="absolute bottom-2 right-2 z-10 rounded bg-yellow-400 px-1.5 py-0.5 text-[0.6rem] font-black text-black">FILLER</span>
      {/if}

      {#if released && !selecting}
        <span class="absolute inset-0 grid place-items-center opacity-90 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <span class="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-black">▶</span>
        </span>
      {:else if !released}
        <span class="absolute bottom-2 left-2 text-[0.7rem] font-bold text-theme">
          {isNext ? `airing in ${countdown(next?.timeUntilAiring)}` : 'Not aired'}
        </span>
      {/if}

      <!-- Download progress (blue) while downloading; otherwise watch progress (theme). -->
      {#if dling}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full bg-blue-400 transition-[width] duration-300 ease-out" style={`width:${dlPct}%`}></span></span>
      {:else if pct > 0}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full bg-theme" style={`width:${pct}%`}></span></span>
      {/if}
    </div>

    <div class="flex items-center gap-2 p-2">
      <div class="min-w-0 flex-1">
        <span class:blur-sm={spoiler} class="block truncate text-sm font-bold">{epTitle}</span>
        <span class="block text-[0.7rem] text-muted-foreground">Episode {ep}{dl?.status === 'done' ? ' · Downloaded' : ''}</span>
      </div>
    </div>
  {:else}
    <div class="relative flex items-center gap-3 p-3">
      <span class="grid h-9 min-w-9 shrink-0 place-items-center rounded bg-background/50 px-1.5 text-xs font-black tabular-nums">{ep}</span>
      <div class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span class:blur-sm={spoiler} class="truncate text-sm font-bold">{epTitle}</span>
          {#if filler}<span class="shrink-0 rounded bg-yellow-400 px-1 text-[0.6rem] font-bold text-black">FILLER</span>{/if}
        </span>
        {#if isNext}
          <span class="block text-[0.7rem] font-bold text-theme">airing in {countdown(next?.timeUntilAiring)}</span>
        {:else if !released}
          <span class="block text-[0.7rem] text-muted-foreground">Not aired</span>
        {:else}
          <span class="block text-[0.7rem] text-muted-foreground">Episode {ep}{dl?.status === 'done' ? ' · Downloaded' : ''}</span>
        {/if}
      </div>

      {#if rating != null}
        <span class:blur-sm={spoiler} class="shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-black text-white {ratingBg(rating)}">{rating}%</span>
      {/if}

      {@render statusBadge('shrink-0')}

      {#if dling}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full bg-blue-400 transition-[width] duration-300 ease-out" style={`width:${dlPct}%`}></span></span>
      {:else if pct > 0}
        <span class="absolute inset-x-0 bottom-0 h-1 bg-white/20"><span class="block h-full bg-theme" style={`width:${pct}%`}></span></span>
      {/if}
    </div>
  {/if}
</div>
