<script lang="ts">
  // Desktop agenda layout: the whole week as full-width, top-to-bottom day
  // sections. Only days with airings are shown; each row is roomy enough to read
  // on a laptop (unlike the old 7-column grid). Deck/Game mode never uses this.
  import { onMount } from 'svelte'
  import { type Airing, airTime, aired, until } from '$lib/anilist/schedule'
  import { title, cover } from '$lib/anilist/media'
  import { agendaScrollTop, agendaTargetDay, isAgendaScrollKey } from './agenda-scroll'
  import type { Media } from '$lib/anilist/types'
  import type { MineKind } from '$lib/anilist/my-shows'

  let { days, start, todayIdx, badgeOf, headerOffset = 0 }:
    { days: Airing[][]; start: number; todayIdx: number; badgeOf?: (m: Media) => MineKind | null; headerOffset?: number } = $props()

  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayDate = (i: number) =>
    new Date((start + i * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

  // Days that actually have airings, kept in week order with their weekday index.
  const filled = $derived(days.map((d, i) => ({ d, i })).filter((x) => x.d.length > 0))

  // Auto-scroll to TODAY on open so you don't scroll past Mon–Thu to reach it — the day is often
  // mid-week. Lands on today, or the next day with airings if today has none. Keeps re-aligning as the
  // content settles (e.g. the My Shows/All default flip) UNTIL the user scrolls, then leaves them be.
  let sections = $state<Record<number, HTMLElement>>({})
  let userScrolled = $state(false)
  let aligned = $state(false)
  const targetDay = $derived(agendaTargetDay(days, todayIdx))
  $effect(() => {
    const section = sections[targetDay]
    // Wait for both the target DOM node and the sticky header's measured height. The old
    // scrollIntoView call could run with a zero-height header, leaving today's first rows hidden
    // underneath it once Next up finished laying out.
    if (userScrolled || targetDay < 0 || headerOffset <= 0 || !section) return
    const frame = requestAnimationFrame(() => {
      if (userScrolled) return
      window.scrollTo({
        top: agendaScrollTop(window.scrollY, section.getBoundingClientRect().top, headerOffset),
        behavior: 'auto',
      })
      aligned = true
    })
    return () => cancelAnimationFrame(frame)
  })
  onMount(() => {
    // Mark "user took over" on real input (wheel/touch/arrow) — NOT scroll events, which our own
    // scrollIntoView fires and would otherwise cancel the auto-scroll immediately.
    const stop = () => { if (aligned) userScrolled = true }
    const stopOnKey = (event: KeyboardEvent) => { if (isAgendaScrollKey(event.key)) stop() }
    addEventListener('wheel', stop, { passive: true })
    addEventListener('touchmove', stop, { passive: true })
    addEventListener('keydown', stopOnKey)
    return () => { removeEventListener('wheel', stop); removeEventListener('touchmove', stop); removeEventListener('keydown', stopOnKey) }
  })
</script>

{#if filled.length === 0}
  <p class="text-muted-foreground">Nothing scheduled this week.</p>
{:else}
  <div class="flex flex-col gap-8">
    {#each filled as { d, i } (i)}
      <section bind:this={sections[i]} data-schedule-day={i}>
        <h3 class="mb-3 text-base font-black {i === todayIdx ? 'text-sky-400' : ''}">
          {FULL[i]} · {dayDate(i)}{#if i === todayIdx} · Today{/if}
        </h3>
        <div class="flex flex-col gap-2">
          {#each d as a (a.media.id + '-' + a.episode)}
            {@const mine = badgeOf?.(a.media)}
            <a
              data-focusable
              href={`/app/anime/${a.media.id}`}
              class="flex items-center gap-4 rounded-lg bg-secondary p-2.5 transition-colors hover:bg-accent {aired(a.airingAt) ? 'opacity-55' : ''} {mine ? 'border border-theme/60' : 'border border-transparent'}"
            >
              <img src={cover(a.media)} alt="" loading="lazy"
                   class="h-24 w-16 shrink-0 rounded object-cover" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="line-clamp-2 text-base font-bold leading-tight">{title(a.media)}</p>
                  {#if mine}<span class="shrink-0 rounded bg-theme/15 px-1.5 py-0.5 text-[0.6rem] font-black uppercase tracking-wide text-theme">{mine === 'watching' ? 'Watching' : 'Planning'}</span>{/if}
                </div>
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
