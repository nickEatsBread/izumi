// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { captionOf } from './caption'

describe('captionOf', () => {
  it('prefers the card’s caption attributes', () => {
    document.body.innerHTML = '<div data-part="card" data-caption-title="Frieren" data-caption-meta="Episode 5 · 12m left" tabindex="0"></div>'
    expect(captionOf(document.querySelector('[data-part="card"]'))).toEqual({ title: 'Frieren', meta: 'Episode 5 · 12m left' })
  })
  it('falls back to the card’s title and meta text', () => {
    document.body.innerHTML = '<div data-part="card"><a href="#">x</a><div data-part="card.title"> Long   Title </div><div data-part="card.meta">TV</div></div>'
    expect(captionOf(document.querySelector('a'))).toEqual({ title: 'Long Title', meta: 'TV' })
  })
  it('is empty without a card', () => {
    expect(captionOf(null)).toEqual({ title: '', meta: '' })
  })
})
