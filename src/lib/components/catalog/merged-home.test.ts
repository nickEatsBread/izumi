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
    expect(home).toContain('provider.home(abort.signal, rowIds, publish)')
    expect(home).toContain('catalogScope="all"')
    expect(home).toContain("let { target = 'merged', anilistHero = [] }")
    expect(home).toContain('resolveCatalogHomeRows(target, [...options, ...collectionOptions')
    expect(home).toContain('homeRowOptions(target, selections, abort.signal)')
  })

  it('never lets a theme Home layout rearrange or lock a custom screen', () => {
    const editor = readFileSync(fileURLToPath(new URL('./HomeEditor.svelte', import.meta.url)), 'utf8')
    for (const source of [home, editor]) expect(source).toContain('const themeLayout = $derived(isCustomScreen(target) ? null : $activeThemeLayout)')
    expect(editor).toContain('{#if !isCustomScreen(target)}<ThemeLayoutNotice')
    expect(home).toContain("params = new URLSearchParams({ provider: selection })")
  })
})
