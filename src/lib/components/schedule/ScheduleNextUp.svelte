<script lang="ts">
  // "Next up / airing now" strip: the soonest upcoming episodes (with live countdowns) plus anything
  // that just aired, as a horizontal scroller above the weekly grid. Fed the ALREADY-FILTERED week
  // (My Shows or All), so it reflects whatever view is active. Hidden when nothing's in the window.
  import { type Airing, airTime, until } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'
  import { classifyMine, type MySets } from '$lib/anilist/my-shows'
  import Radio from 'lucide-svelte/icons/radio'

  let { airings, sets, now }: { airings: Airing[]; sets: MySets; now: number } = $props()

  const RECENT = 2 * 3600 * 1000 // "just aired" window

  // Upcoming first (soonest → latest), then the just-aired ones, capped. `now` is passed in (a store
  // tick) so the countdowns refresh without this component owning a timer.
  const items = $derived.by(() => {
    const up = airings.filter((a) => a.airingAt * 1000 > now).sort((x, y) => x.airingAt - y.airingAt)
    const just = airings
      .filter((a) => a.airingAt * 1000 <= now && now - a.airingAt * 1000 <= RECENT)
      .sort((x, y) => y.airingAt - x.airingAt)
    return [...up, ...just].slice(0, 12)
  })
</script>

{#if items.length}
  <div class="mb-6">
    <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
      <Radio size={15} class="text-theme" /> Next up
    </h2>
    <div class="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {#each items as a (a.media.id + '-' + a.episode)}
        {@const soon = a.airingAt * 1000 > now}
        {@const kind = classifyMine(a.media, sets)}
        <a data-focusable href={`/app/anime/${a.media.id}`}
           class="group relative w-40 shrink-0 overflow-hidden rounded-lg bg-secondary transition-colors hover:bg-accent
                  {kind ? 'border border-theme/60' : 'border border-transparent'}">
          <div class="relative h-24 w-full overflow-hidden">
            <img src={cover(a.media)} alt="" loading="lazy" class="h-full w-full object-cover transition-transform group-hover:scale-105" />
            <span class="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[0.65rem] font-black
                         {soon ? 'bg-emerald-500/90 text-white' : 'bg-sky-500/90 text-white'}">
              {soon ? until(a.airingAt, now) : 'just aired'}
            </span>
          </div>
          <div class="p-2">
            <p class="line-clamp-2 text-xs font-bold leading-tight">{title(a.media)}</p>
            <p class="mt-1 text-[0.7rem] text-muted-foreground">EP {a.episode} · {airTime(a.airingAt)}</p>
          </div>
        </a>
      {/each}
    </div>
  </div>
{/if}
