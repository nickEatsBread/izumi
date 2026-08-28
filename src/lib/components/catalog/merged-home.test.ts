import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeMergedCatalogHomeRowId, mergedCatalogHomeRowId } from '$lib/catalog/registry'

const home = readFileSync(fileURLToPath(new URL('./MergedCatalogHome.svelte', import.meta.url)), 'utf8')

describe('merged catalog Home', () => {
  it('names provider-owned rows without losing their original ids', () => {
    expect(mergedCatalogHomeRowId('tmdb', 'trending')).toBe('tmdb:trending')
    expect(decodeMergedCatalogHomeRowId('jvm:popular:source-id')).toEqual({
      selection: 'jvm', rowId: 'popular:source-id',
    })
    expect(decodeMergedCatalogHomeRowId('unknown:popular')).toBeNull()
  })

  it('loads only configured rows and keeps Continue Watching cross-provider', () => {
    expect(home).toContain('provider.home(abort.signal, rowIds)')
    expect(home).toContain('catalogScope="all"')
    expect(home).toContain("resolveCatalogHomeRows('merged'")
    expect(home).toContain("params = new URLSearchParams({ provider: selection })")
  })
})
