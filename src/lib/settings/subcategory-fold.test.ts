import { afterEach, describe, expect, it } from 'vitest'
import {
  rememberSubcategory, resetSubcategoryFoldForTests, subcategoryFoldable, subcategoryLine, subcategoryStartsCollapsed,
} from './subcategory-fold'

afterEach(() => resetSubcategoryFoldForTests())

const start = (over: Partial<Parameters<typeof subcategoryStartsCollapsed>[0]>) =>
  subcategoryStartsCollapsed({ foldable: true, controller: true, section: 'playback', id: 'skipping', first: false, ...over })

describe('subcategory folding (spec §5.3)', () => {
  it('folds every subcategory in controller mode, elsewhere only Advanced unless the page says', () => {
    expect(subcategoryFoldable(true, undefined, false)).toBe(true)
    expect(subcategoryFoldable(true, false, false)).toBe(true)
    expect(subcategoryFoldable(false, undefined, true)).toBe(true)
    expect(subcategoryFoldable(false, undefined, false)).toBe(false)
    expect(subcategoryFoldable(false, true, false)).toBe(true)
  })

  it('opens only the first subcategory in controller mode; elsewhere a foldable one starts closed', () => {
    expect(start({ first: true })).toBe(false)
    expect(start({ first: false })).toBe(true)
    expect(start({ controller: false, first: true })).toBe(true)
    expect(start({ foldable: false })).toBe(false)
  })

  it('remembers what was opened or closed per section, in controller mode only', () => {
    rememberSubcategory(true, 'playback', 'skipping', true)
    rememberSubcategory(true, 'playback', 'up-next', false)
    rememberSubcategory(false, 'playback', 'seeking', true)
    expect(start({ id: 'skipping' })).toBe(false)
    expect(start({ id: 'up-next', first: true })).toBe(true)
    expect(start({ id: 'seeking' })).toBe(true)
    expect(start({ section: 'subtitles', id: 'skipping' })).toBe(true)
  })

  it('says what is inside: the page summary, else the row count in controller mode', () => {
    expect(subcategoryLine('Rendering preset, mpv options, +5', false, 7)).toBe('Rendering preset, mpv options, +5')
    expect(subcategoryLine(undefined, true, 6)).toBe('6 settings')
    expect(subcategoryLine(undefined, true, 1)).toBe('1 setting')
    expect(subcategoryLine(undefined, true, 0)).toBe('')
    expect(subcategoryLine(undefined, false, 6)).toBe('')
  })
})
