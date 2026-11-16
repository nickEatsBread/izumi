import { describe, expect, it } from 'vitest'
import type { InstalledTheme } from '$lib/themes/installed'
import { DEFAULT_THEME_CARD, appliedThemeCard, cardAfterRemove, themeOptionIds } from './controller-themes'

const theme = (id: string, extra: Partial<InstalledTheme> = {}) => ({ id, designId: `design-${id}`, ...extra }) as InstalledTheme

describe('controller theme list state', () => {
  it('marks the default under izumi, the active install under custom, and nothing under a palette', () => {
    const items = [theme('neon'), theme('paper')]
    expect(appliedThemeCard('izumi', 'design-neon', items)).toBe(DEFAULT_THEME_CARD)
    expect(appliedThemeCard('custom', 'design-paper', items)).toBe('paper')
    expect(appliedThemeCard('custom', 'izumi-studio', items)).toBeNull()
    expect(appliedThemeCard('midnight', 'design-neon', items)).toBeNull()
  })

  it('offers update and restore only when they can run, and always remove', () => {
    expect(themeOptionIds(theme('a'), { update: false })).toEqual(['remove'])
    expect(themeOptionIds(theme('a', { previous: {} as InstalledTheme['previous'] }), { update: true }))
      .toEqual(['update', 'restore', 'remove'])
  })

  it('moves focus to the next card after a removal, else the one before', () => {
    const ids = [DEFAULT_THEME_CARD, 'a', 'b']
    expect(cardAfterRemove(ids, 'a')).toBe('b')
    expect(cardAfterRemove(ids, 'b')).toBe('a')
    expect(cardAfterRemove(ids, 'gone')).toBeNull()
  })
})
