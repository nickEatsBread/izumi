import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolvedGridColumns, virtualGridRange } from './virtual-grid'

describe('virtualGridRange', () => {
  it('keeps a row-aligned overscanned window and equivalent spacer height', () => {
    const range = virtualGridRange({
      itemCount: 300,
      columns: 3,
      rowHeight: 200,
      rowGap: 20,
      containerTop: -4400,
      viewportHeight: 800,
      overscanViewports: 1,
    })
    expect(range.startRow).toBe(16)
    expect(range.startIndex).toBe(48)
    expect(range.endIndex % 3).toBe(0)
    expect(range.topSpacerPx).toBe(16 * 220 - 20)
    expect(range.totalHeightPx).toBe(100 * 220 - 20)
    expect(range.topSpacerPx + range.bottomSpacerPx).toBeLessThan(range.totalHeightPx)
  })

  it('uses visual scale only for viewport math, not CSS spacer sizes', () => {
    const base = virtualGridRange({
      itemCount: 120,
      columns: 4,
      rowHeight: 180,
      rowGap: 12,
      containerTop: -1920,
      viewportHeight: 768,
      scale: 1,
      overscanViewports: 0,
    })
    const zoomed = virtualGridRange({
      itemCount: 120,
      columns: 4,
      rowHeight: 180,
      rowGap: 12,
      containerTop: -3840,
      viewportHeight: 1536,
      scale: 2,
      overscanViewports: 0,
    })
    expect(zoomed).toEqual(base)
  })

  it('clamps empty and final partial rows', () => {
    expect(virtualGridRange({
      itemCount: 0, columns: 3, rowHeight: 100, rowGap: 10, containerTop: 0, viewportHeight: 800,
    })).toMatchObject({ startIndex: 0, endIndex: 0, totalRows: 0, totalHeightPx: 0 })

    const range = virtualGridRange({
      itemCount: 10,
      columns: 3,
      rowHeight: 100,
      rowGap: 10,
      containerTop: -10_000,
      viewportHeight: 800,
      overscanViewports: 0,
    })
    expect(range).toMatchObject({ startIndex: 10, endIndex: 10, totalRows: 4 })
  })
})

describe('resolvedGridColumns', () => {
  it('counts resolved tracks without splitting function arguments', () => {
    expect(resolvedGridColumns('120px 120px 120px')).toBe(3)
    expect(resolvedGridColumns('minmax(0px, 1fr) minmax(0px, 1fr)')).toBe(2)
    expect(resolvedGridColumns('none')).toBe(1)
  })
})

describe('infinite search virtualization', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const searches = [
    read('./search/SearchResults.svelte'),
    read('./catalog/CatalogSearchPage.svelte'),
    read('./catalog/MergedCatalogSearchPage.svelte'),
  ]

  it('routes every unbounded result grid through the shared virtual window', () => {
    for (const source of searches) {
      expect(source).toContain('<VirtualGrid')
      expect(source).not.toContain("window.addEventListener('scroll'")
    }
  })
})
