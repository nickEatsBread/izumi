import { describe, expect, it } from 'vitest'
import { parsePresentation, resolvePresentation } from './presentation'
import { parseThemeBlock } from './block-schema'

describe('the Continue Watching empty state (API 4 `empty`)', () => {
  it('parses on a row entry and refuses older packages', () => {
    const layout = parsePresentation({ rows: { byId: { continue: { empty: 'shown' }, 'anilist:continue': { empty: 'hidden' } } } }, 4)
    expect(layout.rows?.byId?.continue).toEqual({ empty: 'shown' })
    expect(layout.rows?.byId?.['anilist:continue']).toEqual({ empty: 'hidden' })
    expect(() => parsePresentation({ rows: { byId: { continue: { empty: 'shown' } } } }, 3)).toThrow('unsupported')
    expect(() => parsePresentation({ rows: { byId: { continue: { empty: 'always' } } } }, 4)).toThrow()
  })
  it('follows the phone block like any row entry', () => {
    const layout = parsePresentation({ rows: { byId: { continue: { width: 264 } } }, mobile: { rows: { byId: { continue: { empty: 'shown' } } } } }, 4)
    expect(resolvePresentation(layout, true)?.rows?.byId?.continue).toEqual({ empty: 'shown' })
    expect(resolvePresentation(layout, false)?.rows?.byId?.continue).toEqual({ width: 264 })
  })
})

describe('a recently aired tab', () => {
  it('is a role a tabbed grid accepts in a theme layout, on every API that has layouts', () => {
    const block = { block: 'tabbed-grid', tabs: [{ label: 'Newest', role: 'recent' }, { label: 'Popular', role: 'popular' }], columns: 3, pageSize: 18, pagination: 'more' }
    expect(parseThemeBlock(block, 3)).toMatchObject({ type: 'tabbed-grid', tabs: [{ label: 'Newest', role: 'recent' }, { label: 'Popular', role: 'popular' }] })
    expect(parsePresentation({ layout: { home: [block] } }, 4).layout?.home?.[0]).toMatchObject({ block: 'tabbed-grid' })
  })
})
