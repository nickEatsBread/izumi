<script lang="ts">
  // The info block of a theme's docked watch page (`player.dock.below: [… "info" …]`): the poster,
  // "Title - 12" linking to the series page, then the format, episode count and airing state, and
  // the season — the lines a streaming site prints under its player instead of over the video.
  import { nowPlaying, nowPlayingMedia } from '$lib/player/session'
  import { cover, format, mediaHref, season, title } from '$lib/anilist/media'

  const media = $derived($nowPlayingMedia?.media ?? null)
  const episode = $derived($nowPlaying.episode ?? $nowPlayingMedia?.episode ?? null)
  const AIRING: Record<string, string> = {
    RELEASING: 'Currently Airing',
    FINISHED: 'Finished Airing',
    NOT_YET_RELEASED: 'Not yet aired',
    CANCELLED: 'Cancelled',
    HIATUS: 'On Hiatus',
  }
  const count = $derived(media?.episodes ? `${media.episodes} Episode${media.episodes === 1 ? '' : 's'}` : '? Episode')
  const airing = $derived(media?.status ? AIRING[media.status] : undefined)
</script>

{#if media}
  <div data-slot="watch.info" class="flex gap-4 bg-background py-4 text-sm text-muted-foreground">
    {#if cover(media)}
      <a data-part="watch.info.poster" href={mediaHref(media)} class="block w-20 shrink-0 self-start overflow-hidden rounded">
        <img src={cover(media)} alt="" class="aspect-[2/3] w-full object-cover" />
      </a>
    {/if}
    <div class="min-w-0">
      <h1 data-part="watch.info.title" class="text-base font-semibold text-foreground">
        <a href={mediaHref(media)} class="hover:underline">{title(media)}</a>{#if episode != null}<span>{` - ${episode}`}</span>{/if}
      </h1>
      <div data-part="watch.info.meta">{[format(media), count].filter(Boolean).join(' - ')}{airing ? ` (${airing})` : ''}</div>
      {#if season(media)}<div data-part="watch.info.season">{season(media)}</div>{/if}
    </div>
  </div>
{/if}
