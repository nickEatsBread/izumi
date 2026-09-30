<script lang="ts">
  import type { Snippet } from 'svelte'

  // Home's main column and, when blocks are placed there, a side column. From 1100 px the side
  // column sits beside the main one; narrower windows stack it after the main column. `stack` is the
  // spacing class the renderer used between rows before columns existed (e.g. `space-y-5`).
  // `asideGap` is the gutter between the columns: a main row scrolls inside itself, so its own
  // padding only shows at the end of the scroll and its cards ran up against the side column.
  // `asideStart` is the main row the side column starts beside: the rows before it span the whole
  // width, the way a site runs its first rows edge to edge and puts its sidebar beside a later one.
  let { main, aside, asideWidth = 320, asideGap = 32, asideStart = 0, stack = '', row }: {
    main: string[]
    aside: string[]
    asideWidth?: number
    asideGap?: number
    asideStart?: number
    stack?: string
    row: Snippet<[string]>
  } = $props()

  const width = $derived(Math.min(420, Math.max(240, Math.round(asideWidth))))
  const gap = $derived(Math.min(96, Math.max(0, Math.round(asideGap))))
  // Counted in rows after the featured banner, which leaves the list while it leads Home (it renders
  // full-bleed above the columns) but flows through it while Edit Home is open.
  const start = $derived.by(() => {
    const wanted = aside.length ? Math.max(0, Math.round(asideStart)) : 0
    let seen = 0
    for (let index = 0; index < main.length; index++) {
      if (seen >= wanted) return index
      if (main[index] !== 'hero') seen++
    }
    return main.length
  })
  const lead = $derived(main.slice(0, start))
  const beside = $derived(main.slice(start))
  // The space the stack class puts between rows, kept between the full-width rows and the columns.
  const stackGap = $derived(`${Number(/space-y-(\d+(?:\.\d+)?)/.exec(stack)?.[1] ?? 0) * 0.25}rem`)
</script>

<div class="home-columns" class:has-aside={aside.length > 0} style:--home-aside-width={`${width}px`} style:--home-aside-gap={`${gap}px`} style:--home-stack-gap={stackGap}>
  {#if lead.length}
    <div data-slot="home.main" data-variant="lead" class="home-lead min-w-0 {stack}">
      {#each lead as id (id)}{@render row(id)}{/each}
    </div>
  {/if}
  <div data-slot="home.main" class="min-w-0 {stack}">
    {#each beside as id (id)}{@render row(id)}{/each}
  </div>
  {#if aside.length}
    <aside data-slot="home.aside" class="min-w-0 {stack}">
      {#each aside as id (id)}{@render row(id)}{/each}
    </aside>
  {/if}
</div>

<style>
  .home-columns { display: grid; grid-template-columns: minmax(0, 1fr); }
  .home-lead + [data-slot='home.main'] { margin-top: var(--home-stack-gap); }
  @media (min-width: 1100px) {
    .home-columns.has-aside { grid-template-columns: minmax(0, 1fr) var(--home-aside-width); column-gap: var(--home-aside-gap); align-items: start; }
    .home-columns.has-aside > .home-lead { grid-column: 1 / -1; }
    .home-columns.has-aside > .home-lead ~ aside { margin-top: var(--home-stack-gap); }
    /* Side-column blocks keep the page's right gutter but not a second left one. */
    .home-columns.has-aside > aside :global([data-block]) { padding-left: 0; }
  }
</style>
