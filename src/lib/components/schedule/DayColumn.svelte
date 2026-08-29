<script lang="ts">
  import { type Airing, airTime, aired, until } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import type { MineKind } from '$lib/anilist/my-shows'
  import { delayLines, type ScheduleInfo } from '$lib/anime/animeschedule'
  import { scheduleCardNav } from './schedule-nav'

  let { label, airings, today = false, big = false, badgeOf, infoOf, navFirst }:
    { label: string; airings: Airing[]; today?: boolean; big?: boolean
      badgeOf?: (m: Media) => MineKind | null; infoOf?: (m: Media) => ScheduleInfo | null
      navFirst?: string } = $props()

  // Only the leading delay line fits a schedule row; the detail page carries the full set.
  const delayOf = (m: Media) => delayLines(infoOf?.(m) ?? null)[0] ?? ''
</script>

<div class="flex min-w-0 flex-col">
  {#if !big}
    <h3 class="mb-2 text-sm font-black {today ? 'text-sky-400' : ''}">{label}{#if today} · Today{/if}</h3>
  {/if}
  <div class={big ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'flex flex-col gap-2'}>
    {#if airings.length}
      {#each airings as a, i (a.media.id + '-' + a.episode)}
        {@const mine = badgeOf?.(a.media)}
        {@const delay = delayOf(a.media)}
        {@const nav = scheduleCardNav(big ? navFirst : undefined, i, airings.length)}
          <a
            data-focusable
            data-nav-id={nav.id}
            data-nav-left={nav.left}
            data-nav-right={nav.right}
            href={`/app/anime/${a.media.id}`}
            class="flex min-w-0 items-center gap-3 rounded-xl border bg-secondary p-2.5 transition-colors hover:bg-accent {aired(a.airingAt) ? 'opacity-70' : ''} {mine ? 'border-border/80' : 'border-transparent'}"
          >
            <img src={cover(a.media)} alt="" loading="lazy" decoding="async"
                 class="{big ? 'h-20 w-14' : 'h-14 w-10'} shrink-0 rounded-lg object-cover" />
            <div class="min-w-0 flex-1">
              <p class="line-clamp-2 {big ? 'text-sm' : 'text-xs'} font-bold leading-tight">{title(a.media)}</p>
              <p class="mt-1 text-[0.7rem] text-muted-foreground">Episode {a.episode} · <span class="font-bold tabular-nums text-foreground">{airTime(a.airingAt)}</span></p>
              {#if delay}<p class="mt-1 text-xs font-bold text-amber-400">{delay}</p>{/if}
              <div class="mt-2 flex items-center gap-2">
                {#if mine}<span class="rounded-full bg-foreground/[0.08] px-2 py-1 text-[0.65rem] font-black uppercase tracking-wide text-foreground/70">{mine === 'watching' ? 'Watching' : 'Planning'}</span>{/if}
                <span class="text-[0.7rem] font-bold {aired(a.airingAt) ? 'text-muted-foreground' : 'text-emerald-400'}">{aired(a.airingAt) ? 'Aired' : until(a.airingAt)}</span>
              </div>
            </div>
          </a>
      {/each}
    {:else}
      <div class="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled for this day.</div>
    {/if}
  </div>
</div>
