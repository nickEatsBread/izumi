import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../../app.css')

// Phone feel: the WebView must not paint its own tap flash or start selections on controls, rows
// must settle on a card edge, and the small controls a thumb actually uses need real hit areas.
describe('mobile touch feel', () => {
  it('turns off the WebView tap flash and control text selection on coarse pointers', () => {
    const block = css.match(/@media \(pointer: coarse\) \{[^}]*\}[^}]*\}/)
    expect(block, 'pointer: coarse block').toBeTruthy()
    expect(block![0]).toContain('-webkit-tap-highlight-color: transparent')
    expect(block![0]).toMatch(/a, button, \[data-focusable\], \[data-theme-card\] \{[^}]*user-select: none/)
  })

  it('snaps phone carousels to card edges and contains their overscroll, phones only', () => {
    const block = css.match(/@media \(max-width: 640px\) and \(pointer: coarse\) \{[\s\S]*?\n\}/)
    expect(block, 'phone carousel block').toBeTruthy()
    expect(block![0]).toContain('[data-carousel-scroller] { scroll-snap-type: x proximity; scroll-padding-inline: 1rem; overscroll-behavior-x: contain; }')
    expect(block![0]).toContain('[data-carousel-scroller] > * { scroll-snap-align: start; }')
  })

  it('keeps a poster caption next to its title in the phone grid', () => {
    const card = read('./cards/SmallCard.svelte')
    expect(card).toContain("<div data-theme-card-label class={reserveTitleLines ? 'min-h-[3.3rem]' : ''}>")
    expect(card).not.toContain("leading-tight {reserveTitleLines ? 'min-h-[2rem]' : ''}")
  })

  it('gives the hero dots and the View more link finger-sized hit areas', () => {
    const hero = read('./banner/Hero.svelte')
    expect(hero).toContain("before:absolute before:-inset-x-1.5 before:-inset-y-3 before:content-['']")
    const carousel = read('./cards/Carousel.svelte')
    expect(carousel).toContain("{mob ? '-my-2 py-2 pl-2' : ''}")
  })
})
