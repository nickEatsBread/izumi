<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { title, cover, season, format } from '$lib/anilist/media'
  let { media }: { media: Media } = $props()
  const dot = (m: Media) => m.status === 'RELEASING' ? '#3db4f2' : m.status === 'NOT_YET_RELEASED' ? '#f79a63' : '#7bd555'
</script>
<a href={`/app/anime/${media.id}`} data-focusable
   class="load-in group block w-[152px] shrink-0">
  <div class="h-[228px] w-[152px] overflow-hidden rounded-md bg-muted">
    <img src={cover(media)} alt={title(media)} loading="lazy"
         class="h-full w-full object-cover transition group-hover:scale-105" />
  </div>
  <div class="mt-1 flex items-start gap-1">
    <span class="mt-1 h-2 w-2 shrink-0 rounded-full" style={`background:${dot(media)}`}></span>
    <span class="line-clamp-2 text-[0.8rem] font-black leading-tight">{title(media)}</span>
  </div>
  <div class="mt-0.5 flex justify-between text-[0.7rem] text-muted-foreground">
    <span>{season(media)}</span><span>{format(media)}</span>
  </div>
</a>
