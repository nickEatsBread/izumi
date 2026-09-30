import { describe, expect, it } from 'vitest'
import { glyphFamily, glyphFor } from './glyphs'

describe('glyph family', () => {
  it('follows Game mode, then the pad id', () => {
    expect(glyphFamily('', true)).toBe('deck')
    expect(glyphFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)', false)).toBe('xbox')
    expect(glyphFamily('054c-0ce6-DualSense Wireless Controller', false)).toBe('playstation')
    expect(glyphFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', false)).toBe('playstation')
    expect(glyphFamily('057e-2009-Pro Controller', false)).toBe('nintendo')
    expect(glyphFamily('28de-1205-Steam Deck Controller', false)).toBe('deck')
    expect(glyphFamily('', false)).toBe('xbox')
  })
})

describe('glyph faces', () => {
  it('prints each family’s labels', () => {
    expect(glyphFor('deck', 'a')).toEqual({ text: 'A', name: 'A button', shape: 'round' })
    expect(glyphFor('xbox', 'l2')).toEqual({ text: 'LT', name: 'LT button', shape: 'pill' })
    expect(glyphFor('playstation', 'b')).toEqual({ text: '○', name: 'Circle button', shape: 'round' })
    expect(glyphFor('deck', 'start')).toEqual({ text: '☰', name: 'Menu button', shape: 'pill' })
  })
  it('labels the bottom face button B on Nintendo pads', () => {
    expect(glyphFor('nintendo', 'a').text).toBe('B')
    expect(glyphFor('nintendo', 'b').text).toBe('A')
  })
})
