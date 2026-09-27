import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('theme top bar', () => {
  it('shows text links and a centred brand with the plain izumi text when the theme asks', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("const topBar = $derived($themePresentation?.shell?.top ?? {})")
    expect(bar).toContain("topBar.labels ?? 'icons'")
    expect(bar).toContain("topBar.brand === 'center'")
    expect(bar).toContain('{#if top}<BrandText')
  })

  it('puts a search field in the bar instead of the Search link', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('<TopSearchField')
    expect(bar).toContain("topBar.search === 'field-center'")
    expect(bar).toContain("topBar.search === 'field-end'")
    const field = read('./TopSearchField.svelte')
    expect(field).toContain('data-part="search.field"')
    expect(field).toContain('/app/search?search=')
  })

  it('opens every destination in a drawer from a menu button', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("topBar.menu === 'drawer'")
    expect(bar).toContain('data-part="nav.menu"')
    expect(bar).toContain('<NavDrawer')
    const drawer = read('./NavDrawer.svelte')
    expect(drawer).toContain('data-slot="nav.drawer"')
    expect(drawer).toContain("event.key === 'Escape'")
  })

  it('closes the drawer like the app\'s other modals and returns focus to the menu button', () => {
    const drawer = read('./NavDrawer.svelte')
    expect(drawer).toContain('role="dialog"')
    expect(drawer).toContain('aria-modal="true"')
    expect(drawer).toContain('data-nav-trap data-nav-escape')
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('bind:this={menuBtn}')
    expect(bar).toContain('menuBtn?.focus({ preventScroll: true })')
  })

  it('lays the centred-brand top bar out as three grid columns so the links cannot run under it', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain("{brandCentered ? '!grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}")
    expect(bar).toContain('class="flex min-w-0 items-center gap-1 overflow-hidden"')
    expect(bar).toContain('class="flex items-center justify-end gap-1"')
    // The side rail and the non-centred top bar must keep their exact existing layout classes —
    // the grid override is appended, not substituted, so this string must stay byte-for-byte.
    expect(bar).toContain("top ? 'inset-x-0 top-0 h-[4.75rem] w-full flex-row items-center border-b border-border/50 bg-background px-3 pt-8' : 'inset-y-0 left-0 flex-col py-3 pt-9'")
  })

  it('gives TopSearchField a focusable/tabindex passthrough so it is not a Tab stop during playback', () => {
    const field = read('./TopSearchField.svelte')
    expect(field).toContain('focusable = true')
    expect(field).toContain('data-focusable={focusable ? \'\' : undefined} {tabindex}')
    const bar = read('./Sidebar.svelte')
    const fieldCalls = bar.match(/<TopSearchField [^/]*\/>/g) ?? []
    expect(fieldCalls.length).toBe(3)
    for (const call of fieldCalls) {
      expect(call).toContain('focusable={!$playing}')
      expect(call).toContain('tabindex={tab}')
    }
  })
})

describe('top bar categories menu', () => {
  it('adds a Categories menu of browse links and genres when the theme asks', () => {
    const bar = read('./Sidebar.svelte')
    expect(bar).toContain('{#if top && topBar.categories}<CategoriesMenu focusable={!$playing} tabindex={tab} />{/if}')
    const menu = read('./CategoriesMenu.svelte')
    expect(menu).toContain('data-part="nav.item" data-variant="menu"')
    expect(menu).toContain('data-slot="nav.categories"')
    expect(menu).toContain('data-part="nav.categories.heading"')
    expect(menu.match(/data-part="nav\.categories\.link"/g)?.length).toBe(3)
    // The links follow the catalog on screen (categories.ts: a merged scope, AniList-only sorts).
    expect(menu).toContain('const target = $derived(categoriesCatalog($catalogScreen, $catalogProviders))')
    expect(menu).toContain('href={genreHref(target, genre)}')
    expect(menu).toContain('href={browseAllHref(target)}')
    expect(menu).toContain('href="/app/schedule"')
    expect(menu).toContain('loadGenres(catalog)')
    expect(menu).toContain('use:portal')
    expect(menu).toContain("$showAdult || genre.toLowerCase() !== 'hentai'")
  })

  it('is a labelled panel of links that a controller enters, and leaves with B', () => {
    const menu = read('./CategoriesMenu.svelte')
    // Not an ARIA menu: its keyboard model (arrow keys, typeahead) is not implemented.
    expect(menu).not.toContain('role="menu')
    expect(menu).not.toContain('aria-haspopup')
    expect(menu).toContain('<nav use:portal bind:this={panel} data-slot="nav.categories" aria-label="Categories" data-nav-trap data-nav-escape')
    // Like the menu drawer: opening moves focus in; Escape (B on a controller) closes and returns it.
    expect(menu).toContain("if (open) panel?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true })")
    expect(menu).toContain("event.key === 'Escape'")
    expect(menu).toContain('trigger?.focus({ preventScroll: true })')
  })

  it('asks for the genres again after a failed or empty load', () => {
    const menu = read('./CategoriesMenu.svelte')
    expect(menu).toContain("if (!list.length) requested = ''")
    expect(menu).toContain(".catch(() => {\n        if (requested !== catalog) return\n        genres = []\n        requested = ''")
  })

  it('keeps the panel inside the window at its measured width', () => {
    const menu = read('./CategoriesMenu.svelte')
    expect(menu).toContain('categoriesPanelPlace(box, node.getBoundingClientRect().width, window.innerWidth, rootZoom())')
    expect(menu).toContain('new ResizeObserver(measure)')
    expect(menu).not.toContain('- 840')
  })

  it('lets a genre or sort link start a fresh search while search is open', () => {
    const search = read('../../../routes/app/search/+page.svelte')
    expect(search).toContain('afterNavigate((navigation) => {')
    expect(search).toContain("const linked = navigation.type === 'link' || navigation.type === 'goto'")
    expect(search).toContain('if (linked && (urlGenre || urlSort) && (urlGenre !== currentGenre || urlSort !== filters.sort)) {')
    expect(search).toContain('genres: urlGenre ? [urlGenre] : undefined')
  })

  it('re-mounts a provider catalog search on a link with another genre or sort', () => {
    // Those pages read the URL once. They mirror their filters into the address bar with
    // replaceState, which `page.url` does not follow, so the comparison uses the live address as it
    // stood just before the navigation.
    const search = read('../../../routes/app/search/+page.svelte')
    expect(search).toContain('beforeNavigate(() => {')
    expect(search).toContain('const live = new URLSearchParams(location.search)')
    expect(search).toContain('if (linked && (urlGenre || urlSort) && (urlGenre !== shownGenre || urlSort !== shownSort)) catalogSearchKey += 1')
    expect(search.match(/\{#key catalogSearchKey\}<CatalogSearchPage /g)?.length).toBe(2)
  })

  it('opens the merged catalog scope a link names', () => {
    const search = read('../../../routes/app/search/+page.svelte')
    expect(search).toContain("const urlScope = params.get('provider') as CatalogSelection | null")
    expect(search).toContain("if (linked && $catalogScreen === 'merged' && urlScope && urlScope !== mergedScope && mergedSelections.includes(urlScope)) mergedScope = urlScope")
  })
})
