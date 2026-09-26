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
})
