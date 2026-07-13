<script lang="ts">
  import { type Airing, airTime, aired, until } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import type { MineKind } from '$lib/anilist/my-shows'

  let { label, airings, today = false, big = false, badgeOf }:
    { label: string; airings: Airing[]; today?: boolean; big?: boolean; badgeOf?: (m: Media) => MineKind | null } = $props()
</script>

<div class="flex min-w-0 flex-col">
  {#if !big}
    <h3 class="mb-2 text-sm font-black {today ? 'text-sky-400' : ''}">{label}{#if today} · Today{/if}</h3>
  {/if}
  <div class={big ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2'}>
    {#if airings.length}
      {#each airings as a (a.media.id + '-' + a.episode)}
        {@const mine = badgeOf?.(a.media)}
        <a
          data-focusable
          href={`/app/anime/${a.media.id}`}
          class="flex items-center gap-2 rounded-md bg-secondary p-1.5 transition-colors hover:bg-accent {aired(a.airingAt) ? 'opacity-55' : ''} {mine ? 'ring-1 ring-theme/60' : ''}"
        >
          <img src={cover(a.media)} alt="" loading="lazy"
               class="{big ? 'h-20 w-14' : 'h-14 w-10'} shrink-0 rounded object-cover" />
          <div class="min-w-0 flex-1">
            <p class="line-clamp-2 {big ? 'text-sm' : 'text-xs'} font-bold leading-tight">{title(a.media)}</p>
            <p class="mt-0.5 {big ? 'text-xs' : 'text-[0.7rem]'} text-muted-foreground">EP {a.episode} · {airTime(a.airingAt)}</p>
            {#if mine}
              <span class="mt-0.5 inline-block rounded px-1 py-px text-[0.6rem] font-black uppercase tracking-wide text-theme">{mine === 'watching' ? 'Watching' : 'Planning'}</span>
            {:else if !aired(a.airingAt)}
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
