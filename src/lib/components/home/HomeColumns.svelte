<script lang="ts">
  import type { Snippet } from 'svelte'

  // Home's main column and, when blocks are placed there, a side column. From 1100 px the side
  // column sits beside the main one; narrower windows stack it after the main column. `stack` is the
  // spacing class the renderer used between rows before columns existed (e.g. `space-y-5`).
  // `asideGap` is the gutter between the columns: a main row scrolls inside itself, so its own
  // padding only shows at the end of the scroll and its cards ran up against the side column.
  let { main, aside, asideWidth = 320, asideGap = 32, stack = '', row }: {
    main: string[]
    aside: string[]
    asideWidth?: number
    asideGap?: number
    stack?: string
    row: Snippet<[string]>
  } = $props()

  const width = $derived(Math.min(420, Math.max(240, Math.round(asideWidth))))
  const gap = $derived(Math.min(96, Math.max(0, Math.round(asideGap))))
</script>

<div class="home-columns" class:has-aside={aside.length > 0} style:--home-aside-width={`${width}px`} style:--home-aside-gap={`${gap}px`}>
  <div data-slot="home.main" class="min-w-0 {stack}">
    {#each main as id (id)}{@render row(id)}{/each}
  </div>
  {#if aside.length}
    <aside data-slot="home.aside" class="min-w-0 {stack}">
      {#each aside as id (id)}{@render row(id)}{/each}
    </aside>
  {/if}
</div>

<style>
  .home-columns { display: grid; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) {
    .home-columns.has-aside { grid-template-columns: minmax(0, 1fr) var(--home-aside-width); column-gap: var(--home-aside-gap); align-items: start; }
    /* Side-column blocks keep the page's right gutter but not a second left one. */
    .home-columns.has-aside > aside :global([data-block]) { padding-left: 0; }
  }
</style>
