<script lang="ts">
  import type { Airing } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'

  let { label, airings, today = false, big = false }:
    { label: string; airings: Airing[]; today?: boolean; big?: boolean } = $props()

  const time = (unix: number) =>
    new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const aired = (unix: number) => unix * 1000 <= Date.now()
  // Compact "still to air" countdown for upcoming episodes.
  function until(unix: number): string {
    const mins = Math.round((unix * 1000 - Date.now()) / 60000)
    if (mins <= 0) return ''
    if (mins < 60) return `in ${mins}m`
    const h = Math.floor(mins / 60)
    return h < 24 ? `in ${h}h` : `in ${Math.floor(h / 24)}d`
  }
</script>

<div class="flex min-w-0 flex-col">
  {#if !big}
    <h3 class="mb-2 text-sm font-black {today ? 'text-sky-400' : ''}">{label}{#if today} · Today{/if}</h3>
  {/if}
  <div class={big ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2'}>
    {#if airings.length}
      {#each airings as a (a.media.id + '-' + a.episode)}
        <a
          data-focusable
          href={`/app/anime/${a.media.id}`}
          class="flex items-center gap-2 rounded-md bg-secondary p-1.5 transition-colors hover:bg-accent {aired(a.airingAt) ? 'opacity-55' : ''}"
        >
          <img src={cover(a.media)} alt="" loading="lazy"
               class="{big ? 'h-20 w-14' : 'h-14 w-10'} shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <p class="line-clamp-2 {big ? 'text-sm' : 'text-xs'} font-bold leading-tight">{title(a.media)}</p>
            <p class="mt-0.5 {big ? 'text-xs' : 'text-[0.7rem]'} text-muted-foreground">EP {a.episode} · {time(a.airingAt)}</p>
            {#if !aired(a.airingAt)}
              <p class="mt-0.5 text-[0.7rem] font-bold text-emerald-400">{until(a.airingAt)}</p>
            {/if}
          </div>
        </a>
      {/each}
    {:else}
      <p class="text-xs text-muted-foreground">Nothing scheduled.</p>
    {/if}
  </div>
</div>
