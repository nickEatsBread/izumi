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
})
