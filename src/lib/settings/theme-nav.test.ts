import { describe, expect, it } from 'vitest'
import { themeNavConfig } from './theme-nav'

describe('theme navigation', () => {
  it('places the listed destinations and hides the rest', () => {
    expect(themeNavConfig({ bottom: ['schedule', 'library'], top: ['search'] }, ['schedule', 'downloads', 'search', 'library'])).toEqual([
      { id: 'schedule', placement: 'bottom' }, { id: 'library', placement: 'bottom' }, { id: 'search', placement: 'top' }, { id: 'downloads', placement: 'hidden' },
    ])
    expect(themeNavConfig({ home: 1 }, ['schedule'])).toBeNull()
  })
})
