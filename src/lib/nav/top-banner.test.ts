// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { inTopBanner } from './index'

const banner = (top: number) => {
  document.body.innerHTML = `<section data-slot="home.hero"><button id="play">Play</button></section><button id="other">x</button>`
  const hero = document.querySelector<HTMLElement>('[data-slot="home.hero"]')!
  hero.getBoundingClientRect = () => ({ top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top, toJSON: () => ({}) })
  return { play: document.getElementById('play')!, other: document.getElementById('other')! }
}

describe('reaching a Home banner from below', () => {
  it('scrolls to the top for a banner that opens the page, not for one further down', () => {
    const { play, other } = banner(-300)
    expect(inTopBanner(play, 300)).toBe(true)
    expect(inTopBanner(other, 300)).toBe(false)
    const lower = banner(500)
    expect(inTopBanner(lower.play, 800)).toBe(false)
  })
})
