<script lang="ts">
  // Desktop agenda layout: the whole week as full-width, top-to-bottom day
  // sections. Only days with airings are shown; each row is roomy enough to read
  // on a laptop (unlike the old 7-column grid). Deck/Game mode never uses this.
  import { type Airing, airTime, aired, until } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'

  let { days, start, todayIdx }:
    { days: Airing[][]; start: number; todayIdx: number } = $props()

  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayDate = (i: number) =>
    new Date((start + i * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

  // Days that actually have airings, kept in week order with their weekday index.
  const filled = $derived(days.map((d, i) => ({ d, i })).filter((x) => x.d.length > 0))
</script>

{#if filled.length === 0}
  <p class="text-muted-foreground">Nothing scheduled this week.</p>
{:else}
  <div class="flex flex-col gap-8">
    {#each filled as { d, i } (i)}
      <section>
        <h3 class="mb-3 text-base font-black {i === todayIdx ? 'text-sky-400' : ''}">
          {FULL[i]} · {dayDate(i)}{#if i === todayIdx} · Today{/if}
        </h3>
        <div class="flex flex-col gap-2">
          {#each d as a (a.media.id + '-' + a.episode)}
            <a
              data-focusable
              href={`/app/anime/${a.media.id}`}
              class="flex items-center gap-4 rounded-lg bg-secondary p-2.5 transition-colors hover:bg-accent {aired(a.airingAt) ? 'opacity-55' : ''}"
            >
              <img src={cover(a.media)} alt="" loading="lazy"
                   class="h-24 w-16 shrink-0 rounded object-cover" />
              <div class="min-w-0 flex-1">
                <p class="line-clamp-2 text-base font-bold leading-tight">{title(a.media)}</p>
                <p class="mt-1 text-sm text-muted-foreground">EP {a.episode} · {airTime(a.airingAt)}</p>
              </div>
              {#if !aired(a.airingAt)}
                <span class="shrink-0 text-sm font-bold text-emerald-400">{until(a.airingAt)}</span>
              {/if}
            </a>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}
