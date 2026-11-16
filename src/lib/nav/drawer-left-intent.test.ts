// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initDpadNav } from './index'

// With the drawer navigation (a theme's `shell.nav: "drawer"`), Home can sit with nothing focused
// (its banner rotating). Left then opens the drawer, as Crunchy Deck does, instead of first
// landing on a control and needing a second Left.
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
let opened = 0
const onOpen = () => { opened++ }

beforeAll(() => {
  initDpadNav()
  window.addEventListener('nav-drawer-open', onOpen)
})
afterEach(() => {
  opened = 0
  delete document.documentElement.dataset.themeNav
  document.body.innerHTML = ''
})

describe('Left with nothing focused', () => {
  it('opens the drawer navigation', () => {
    document.documentElement.dataset.themeNav = 'drawer'
    document.body.innerHTML = '<main><button data-focusable>Play</button></main>'
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('ArrowLeft')
    expect(opened).toBe(1)
  })

  it('lands on a control without the drawer navigation', () => {
    document.body.innerHTML = '<main><button data-focusable>Play</button></main>'
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('ArrowLeft')
    expect(opened).toBe(0)
  })
})
