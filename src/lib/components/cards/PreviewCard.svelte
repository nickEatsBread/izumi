<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title, format, season } from '$lib/anilist/media'
  let { media }: { media: Media } = $props()
</script>
<div class="w-[17.5rem] overflow-hidden rounded-lg bg-card shadow-2xl ring-1 ring-border">
  <div class="relative h-[45%] min-h-[9rem]">
    <img src={banner(media)} alt="" class="h-40 w-full object-cover" />
    <div class="absolute inset-0 bg-gradient-to-t from-card to-transparent"></div>
  </div>
  <div class="p-3">
    <div class="truncate font-black">{title(media)}</div>
    <div class="mt-2 flex gap-2">
      <button class="flex-1 rounded-md bg-primary py-1 text-sm font-bold text-primary-foreground">Play</button>
      <button class="rounded-md bg-secondary px-2 py-1 text-sm">♥</button>
      <button class="rounded-md bg-secondary px-2 py-1 text-sm">＋</button>
    </div>
    <div class="mt-2 text-[11px] text-muted-foreground">{format(media)} · {media.episodes ?? '?'} eps · {season(media)} · {media.averageScore ?? '–'}%</div>
    <p class="mt-1 line-clamp-4 text-[0.7rem] text-muted-foreground">{(media.description ?? '').replace(/<[^>]+>/g, '')}</p>
  </div>
</div>
