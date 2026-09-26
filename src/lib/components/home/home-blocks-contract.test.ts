import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const RENDERERS = ['../../../routes/app/home/+page.svelte', '../catalog/CatalogHome.svelte', '../catalog/MergedCatalogHome.svelte']

describe('Home blocks wiring', () => {
  it('renders blocks and the side column on every Home', () => {
    for (const file of RENDERERS) {
      const source = read(file)
      expect(source, file).toContain('blockRowOptions(')
      expect(source, file).toContain('splitHomeColumns(')
      expect(source, file).toContain('<HomeBlockView')
      expect(source, file).toContain('<HomeColumns')
    }
  })

  it('dispatches every block type', () => {
    const view = read('./HomeBlockView.svelte')
    for (const type of ['latest-episodes', 'tabbed-grid', 'genre-chips', 'ranked-list', 'profile-header']) expect(view).toContain(`block?.type === '${type}'`)
  })

  it('lets Edit Home add, configure and remove blocks', () => {
    const editor = read('../catalog/HomeEditor.svelte')
    expect(editor).toContain('addHomeBlock(target, rows, type')
    expect(editor).toContain('blockRowOptions(target, $catalogHomeLayouts, $homeBlocks)')
    expect(editor).toContain('<BlockSettings')
    expect(editor).toContain('pruneHomeBlocks()')
    const frame = read('../catalog/HomeRowFrame.svelte')
    expect(frame).toContain('removeHomeBlock(target, rowId)')
    expect(frame).toContain('homeBlockSettingsId.set(rowId)')
  })

  it('does not let a block-only edit refetch a provider or external Home', () => {
    const catalogHome = read('../catalog/CatalogHome.svelte')
    expect(catalogHome, 'CatalogHome.svelte').toContain('layout.order.filter((id) => !isBlockId(id))')
    const mergedHome = read('../catalog/MergedCatalogHome.svelte')
    expect(mergedHome, 'MergedCatalogHome.svelte').toContain("import { untrack } from 'svelte'")
    expect(mergedHome, 'MergedCatalogHome.svelte').toContain('untrack(() => rows)')
  })

  it('gives every HomeRowFrame renderer just its own column to move within, and shows every block while editing on a phone', () => {
    for (const file of RENDERERS) {
      const source = read(file)
      expect(source, file).toContain('columns.main.includes(')
      expect(source, file).toContain('$isMobile && !$homeEditorOpen')
    }
  })

  it('gives each block control strip its own nav row instead of one row for the whole section', () => {
    const genreChips = read('./blocks/GenreChips.svelte')
    expect(genreChips).not.toMatch(/data-slot="block\.genre-chips"[^>]*data-nav-row/)
    expect(genreChips).toContain('data-nav-row data-nav-row-wrap data-nav-row-items')

    const latestEpisodes = read('./blocks/LatestEpisodes.svelte')
    expect(latestEpisodes).not.toMatch(/data-slot="block\.latest-episodes"[^>]*data-nav-row/)
    expect(latestEpisodes).toContain('data-nav-row data-nav-row-wrap data-nav-row-items')

    const tabbedGrid = read('./blocks/TabbedGrid.svelte')
    expect(tabbedGrid).not.toMatch(/data-slot="block\.tabbed-grid"[^>]*data-nav-row/)
    expect(tabbedGrid).toContain('<div data-nav-row><Tabs')
    expect(tabbedGrid).toContain('data-nav-row data-nav-row-wrap data-nav-row-items')

    const rankedList = read('./blocks/RankedList.svelte')
    expect(rankedList).not.toMatch(/data-slot="block\.ranked-list"[^>]*data-nav-row/)
    expect(rankedList).toContain('<div data-nav-row><Tabs')
    expect(rankedList).toContain('<ol data-nav-row data-nav-row-wrap data-nav-row-items')

    const pager = read('./Pager.svelte')
    expect(pager).toContain('<nav data-part="pagination" data-nav-row')
    expect(pager).toContain('<div data-part="pagination" data-nav-row')
  })

  it("only gives an AniList row's numbered-page cards an absolute rank", () => {
    const tabbedGrid = read('./blocks/TabbedGrid.svelte')
    expect(tabbedGrid).toContain("if (block.pagination === 'more') return index + 1")
    expect(tabbedGrid).toContain("rowSource(target, rowId)?.kind === 'anilist'")
    expect(tabbedGrid).toContain('return undefined')
  })

  it('keeps tab labels unique when adding or renaming, and never leaves a rejected checkbox toggle checked in the DOM', () => {
    const settings = read('./BlockSettings.svelte')
    expect(settings).toContain('function uniqueTabLabel(')
    expect(settings).toContain('event.currentTarget.value = tab.label')
    expect(settings).toContain('event.currentTarget.checked = exists')
  })

  it('follows the active theme layout without touching the user layout', () => {
    for (const file of RENDERERS) {
      const source = read(file)
      expect(source, file).toContain('$activeThemeLayout?.home')
      expect(source, file).toContain('resolveThemeHome(')
      expect(source, file).toContain('locked={!!themeHome}')
    }
    expect(read('./HomeBlockView.svelte')).toContain('block: override')
  })

  it('offers the theme layout switch and a copy in Edit Home', () => {
    const editor = read('../catalog/HomeEditor.svelte')
    expect(editor).toContain('<ThemeLayoutNotice')
    expect(editor).toContain('forkThemeHome(')
    const notice = read('./ThemeLayoutNotice.svelte')
    expect(notice).toContain('role="switch"')
    expect(notice).toContain('Customize a copy')
  })
})
