<script lang="ts">
  // An episode's own download button (API 4 `detail.episodes.download: "button"`), the trailing control
  // of an episode card or row. It sits inside the episode's element, so its press stops there: the
  // episode never plays from it (EpisodeCard and the list's rows also ignore keys that start on it).
  // `--download-progress` is the share downloaded ("42%"), for a theme's ring or bar.
  import { goto } from '$app/navigation'
  import type { Media } from '$lib/anilist/types'
  import { enqueue, type DownloadItem } from '$lib/downloads/store'
  import { downloadAudio, downloadCachedOnly, downloadCodec, downloadQuality } from '$lib/settings/ui'
  import * as h from '$lib/haptics'
  import Download from '@lucide/svelte/icons/download'
  import Loader from '@lucide/svelte/icons/loader-circle'
  import Check from '@lucide/svelte/icons/check'
  import { episodeDownloadAction, episodeDownloadLabel, episodeDownloadPercent, episodeDownloadState } from './episode-download'

  let { media, ep, dl, released, numberLabel }: {
    media: Media
    ep: number
    dl?: DownloadItem
    /** Only an aired episode can be downloaded; an upcoming one keeps a disabled button in its place. */
    released: boolean
    /** The number the list prints for this episode. */
    numberLabel?: string
  } = $props()

  const downloadState = $derived(episodeDownloadState(dl))
  const percent = $derived(episodeDownloadPercent(dl))
  const label = $derived(released ? episodeDownloadLabel(dl, numberLabel ?? String(ep)) : 'Not yet aired')

  function press(event: MouseEvent) {
    event.stopPropagation()
    if (!released) return
    if (episodeDownloadAction(downloadState) === 'queue') {
      h.select()
      enqueue(media, ep, { quality: $downloadQuality, cachedOnly: $downloadCachedOnly, audio: $downloadAudio, codec: $downloadCodec })
    } else void goto('/app/downloads')
  }
</script>

<button type="button" data-part="episode.download" data-state={downloadState} data-focusable disabled={!released}
        style:--download-progress="{percent}%"
        aria-label={label} title={label} data-hint-a={episodeDownloadAction(downloadState) === 'queue' ? 'Download' : 'Downloads'} onclick={press}
        class="relative grid size-10 shrink-0 place-items-center self-center rounded-full transition-colors disabled:opacity-40 {downloadState === 'done' ? 'text-theme' : 'text-muted-foreground hover:text-foreground'}">
  {#if downloadState === 'done'}<Check size={18} />
  {:else if downloadState === 'queued'}<Loader size={18} class="animate-spin" />
  {:else if downloadState === 'progress'}<span class="text-[0.65rem] font-black tabular-nums">{percent}%</span>
  {:else}<Download size={18} />{/if}
</button>
