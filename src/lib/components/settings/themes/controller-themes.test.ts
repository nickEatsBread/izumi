import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { InstalledTheme } from '$lib/themes/installed'
import { DEFAULT_THEME_CARD, appliedThemeCard, cardAfterRemove, themeCardNavId, themeOptionIds } from './controller-themes'

const theme = (id: string, extra: Partial<InstalledTheme> = {}) => ({ id, designId: `design-${id}`, ...extra }) as InstalledTheme
const list = readFileSync(fileURLToPath(new URL('./ControllerThemeList.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('controller theme list state', () => {
  it('marks the default under izumi, the active install under custom, and nothing under a palette', () => {
    const items = [theme('neon'), theme('paper')]
    expect(appliedThemeCard('izumi', 'design-neon', items)).toBe(DEFAULT_THEME_CARD)
    expect(appliedThemeCard('custom', 'design-paper', items)).toBe('paper')
    expect(appliedThemeCard('custom', 'izumi-studio', items)).toBeNull()
    expect(appliedThemeCard('midnight', 'design-neon', items)).toBeNull()
  })

  it('offers update, restore and store only when they can run, and always remove', () => {
    expect(themeOptionIds(theme('a'), { update: false, store: false })).toEqual(['remove'])
    expect(themeOptionIds(theme('a', { previous: {} as InstalledTheme['previous'] }), { update: true, store: true }))
      .toEqual(['update', 'restore', 'store', 'remove'])
  })

  it('moves focus to the next card after a removal, else the one before', () => {
    const ids = [DEFAULT_THEME_CARD, 'a', 'b']
    expect(cardAfterRemove(ids, 'a')).toBe('b')
    expect(cardAfterRemove(ids, 'b')).toBe('a')
    expect(cardAfterRemove(ids, 'gone')).toBeNull()
  })

  it('names each card by a stable nav id', () => {
    expect(themeCardNavId('neon')).toBe('theme-card:neon')
  })
})

describe('controller theme list markup', () => {
  it('puts each card and its More on one nav line, so Right ends at More and Up/Down step one card', () => {
    expect(list).toContain('<li class="row" data-nav-line data-installed-theme={card.id}>')
    expect(list).toContain('data-nav-id={themeCardNavId(card.id)}')
    expect(list).toContain('class="more" data-focusable')
  })

  it('applies on A and keeps focus on the same card, found again by its id', () => {
    expect(list).toContain('data-hint-a="Apply"')
    expect(list).toContain('if (held) requestAnimationFrame(() => focusCard(card.id))')
  })

  it('never disables a focused card: a Theme Studio draft only marks it', () => {
    expect(list).toContain('aria-disabled={locked || undefined}')
    expect(list).toContain('if (locked) return')
    expect(list).not.toMatch(/class="card"[^>]*\sdisabled=/)
  })

  it('opens the options sheet from More or ☰ on a card', () => {
    expect(list).toContain('<OptionsSheet')
    expect(list).toContain('window.addEventListener(PAGE_OPTIONS_EVENT, claim)')
    expect(list).toContain('onclick={() => (sheetFor = item)}')
  })

  it('has no CSS transitions (Game mode blinks at their end) and no theme hooks (the page is protected)', () => {
    expect(list).not.toMatch(/\btransition(-[a-z]+)?\s*:/)
    expect(list).not.toMatch(/data-(slot|part)=/)
  })
})
