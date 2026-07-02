<script lang="ts">
  import type { Airing } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'

  let { label, airings }: { label: string; airings: Airing[] } = $props()

  const time = (unix: number) =>
    new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<div class="flex min-w-0 flex-col">
  <h3 class="mb-2 text-sm font-black">{label}</h3>
  <div class="flex flex-col gap-2">
    {#if airings.length}
      {#each airings as a (a.media.id + '-' + a.episode)}
        <a
          data-focusable
          href={`/app/anime/${a.media.id}`}
          class="flex items-center gap-2 rounded-md bg-secondary p-1.5 transition-colors hover:bg-accent"
        >
          <img src={cover(a.media)} alt="" loading="lazy" class="h-14 w-10 shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <p class="line-clamp-2 text-xs font-bold leading-tight">{title(a.media)}</p>
            <p class="mt-0.5 text-[0.7rem] text-muted-foreground">EP {a.episode} · {time(a.airingAt)}</p>
          </div>
        </a>
      {/each}
    {:else}
      <p class="text-xs text-muted-foreground">—</p>
    {/if}
  </div>
</div>
