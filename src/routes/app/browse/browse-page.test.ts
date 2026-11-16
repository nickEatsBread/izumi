import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./+page.svelte')
const sorts = read('../../../lib/components/browse/BrowseSorts.svelte')
const categories = read('../../../lib/components/browse/BrowseCategories.svelte')

describe('Browse page', () => {
  it('answers a switch at once: a cached listing, else skeletons, and the old request cancelled', () => {
    expect(page).toContain('const feeds = createBrowseFeeds()')
    expect(page).toContain('feeds.cancelExcept(current)')
    expect(page).toContain('feed = current ? feeds.cached(current) : undefined')
    expect(page).toContain('class="aspect-[2/3] w-full rounded-md skeloader"')
    // A late answer for a listing already switched away from never lands on screen.
    expect(page).toContain('if (current === key) feed = next')
  })

  it('keys a listing by catalog, sort, category and the 18+ setting', () => {
    expect(page).toContain('browseKey(selection, activeSort, activeGenre, $showAdult)')
  })

  it("reuses the search grid's cards, pages near the end and says so", () => {
    expect(page).toContain("setContext(CARD_FAMILY, 'search')")
    expect(page).toContain('<SmallCard media={item} fill reserveTitleLines />')
    expect(page).toContain('part="browse.grid"')
    expect(page).toContain('onEndReached={loadAtEnd}')
    expect(page).toContain('Loading more…')
  })

  it('shows empty and error states with Retry in place of a blank page', () => {
    expect(page).toContain('data-part="browse.empty" data-state="error"')
    expect(page).toContain('data-part="browse.empty" data-state="empty"')
    expect(page.match(/>Retry</g)?.length).toBe(2)
    // A failed page does not re-request on every scroll.
    expect(page).toContain('const loadAtEnd = () => { if (!error && !loading) void more() }')
  })

  it('keeps the view in the address bar without stacking history', () => {
    expect(page).toContain("page.url.searchParams.get('sort')")
    expect(page).toContain("page.url.searchParams.get('genre')")
    expect(page).toContain('replaceState(next, page.state)')
    expect(page).not.toContain('pushState(')
  })

  it('makes the categories a d-pad region beside the grid, entered on the lit category', () => {
    expect(page).toContain('data-nav-region="browse-side" data-nav-scroll-container')
    expect(categories).toContain("data-nav-region-default={column && on ? '' : undefined}")
    // Up from "All" reaches the lit sort pill (a region never lets Up/Down out).
    expect(categories).toContain("data-nav-up={column && index === 0 ? 'browse-sort' : undefined}")
    expect(sorts).toContain("data-nav-id={on ? 'browse-sort' : undefined}")
  })

  it('steps the sorts with the bumpers as the page tab strip', () => {
    expect(sorts).toContain('data-page-tabs')
    expect(sorts).toContain("if (name === 'l1' || name === 'r1') stepPageTabs(name === 'l1' ? -1 : 1)")
    // A theme's top bar owns L1/R1 under bumper tabs; the shell steps the strip with L2/R2 then.
    expect(sorts).toContain('get(bumperTabs)')
    expect(sorts).toContain('topNavLayer()')
  })

  it('animates without CSS transitions in Game mode, and never disables a control', () => {
    expect(sorts).toContain("import { motion } from '$lib/motion/motion'")
    expect(sorts).toContain('in:motion={{ x: [slideFrom, 0], duration: 180 }}')
    for (const source of [page, sorts, categories]) {
      expect(source).not.toMatch(/\sdisabled[\s=>]/)
      for (const match of source.matchAll(/transition-colors/g)) {
        expect(source.slice(match.index! - 30, match.index), 'a transition outside a Game-mode guard').toContain("$gameMode ? '' : ")
      }
    }
    expect(page).toContain('in:fade|global={{ duration: $gameMode ? 0 : 150 }}')
  })

  it("renders a theme's own blocks in the side column", () => {
    expect(page).toContain('?.browse?.filter')
    expect(page).toContain('<HomeBlockView {id} target={selection} block={themeBlocks.blocks[id]} />')
  })
})
