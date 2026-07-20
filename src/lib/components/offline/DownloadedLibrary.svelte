<script lang="ts">
  import { downloads, downloadedMedia } from '$lib/downloads/state'
  import { groupDownloads } from '$lib/downloads/library'
  import { isAndroid } from '$lib/platform'
  import * as h from '$lib/haptics'
  // Offline home library: every series with at least one completed download, poster grid.
  const series = $derived(groupDownloads($downloads, $downloadedMedia))
</script>

{#if series.length}
  <section class="px-4 sm:px-8">
    <h2 class="mb-3 text-lg font-black">Downloaded</h2>
    <div class="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
      {#each series as s (s.mediaId)}
        <a href="/app/anime/{s.mediaId}" data-focusable onclick={() => h.tap()}
           class="group block {$isAndroid ? 'android-card-press' : ''}">
          <div class="focus-cover relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
            {#if s.poster}<img src={s.poster} alt="" class="h-full w-full object-cover" />{/if}
            <span
              class="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-black text-white"
            >{s.episodeCount} ep{s.episodeCount > 1 ? 's' : ''}</span>
          </div>
          <div class="mt-1 truncate text-xs font-bold">{s.title}</div>
        </a>
      {/each}
    </div>
  </section>
{:else}
  <div class="px-4 py-12 text-center text-sm text-muted-foreground sm:px-8">
    No downloads yet — episodes you download appear here.
  </div>
{/if}
