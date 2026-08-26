import { describe, expect, it } from 'vitest'
import { assColor, mpvColor, subtitleStyleProps, DEFAULT_SUBTITLE_FONT, type SubtitleStyle } from './subtitle-style'

const style = (overrides: Partial<SubtitleStyle> = {}): SubtitleStyle => ({
  enabled: true,
  scope: 'dialogue',
  font: 'Nunito',
  bold: false,
  fontSize: 42,
  textColor: '#ffffff',
  borderColor: '#000000',
  borderSize: 3,
  shadow: 1,
  position: 92,
  ...overrides,
})

const lookup = (s: SubtitleStyle) => Object.fromEntries(subtitleStyleProps(s))

describe('mpvColor', () => {
  it('puts the alpha FIRST, as mpv parses #AARRGGBB', () => {
    expect(mpvColor('#000000')).toBe('#ff000000')
    expect(mpvColor('#ff0000')).toBe('#ffff0000')
  })

  it('normalizes case and a missing hash', () => {
    expect(mpvColor('AABBCC')).toBe('#ffaabbcc')
  })

  it('falls back to opaque white on an unparseable value', () => {
    expect(mpvColor('')).toBe('#ffffffff')
    expect(mpvColor('rgb(1,2,3)')).toBe('#ffffffff')
  })
})

describe('assColor', () => {
  it('converts RGB into libass AABBGGRR order', () => {
    expect(assColor('#131220')).toBe('&H00201213&')
  })
})

describe('subtitleStyleProps', () => {
  it('hands styling back to the subtitle file when the override is off', () => {
    expect(subtitleStyleProps(style({ enabled: false }))).toEqual([
      ['sub-ass-style-overrides', ''],
      ['sub-ass-override', 'no'],
    ])
  })

  it('uses mpv dialogue detection by default so signs and positioned text can survive', () => {
    expect(lookup(style())['sub-ass-override']).toBe('yes')
    expect(lookup(style())['sub-ass-style-overrides']).toContain('FontName=Nunito')
  })

  it('only uses the destructive force mode when all elements were explicitly selected', () => {
    expect(lookup(style({ scope: 'all' }))['sub-ass-override']).toBe('force')
    expect(lookup(style({ scope: 'all' }))['sub-ass-style-overrides']).toBe('')
  })

  it('maps every appearance setting onto its mpv property', () => {
    const props = lookup(style({ fontSize: 55, bold: true, borderSize: 4, shadow: 2, position: 80 }))
    expect(props['sub-font']).toBe('Nunito')
    expect(props['sub-font-size']).toBe('55')
    expect(props['sub-bold']).toBe('yes')
    expect(props['sub-border-size']).toBe('4')
    expect(props['sub-shadow-offset']).toBe('2')
    expect(props['sub-pos']).toBe('100')
    expect(props['sub-ass-style-overrides']).toContain('MarginV=144')
  })

  it('keeps the black outline opaque instead of transparent-blue', () => {
    expect(lookup(style())['sub-border-color']).toBe('#ff000000')
  })

  it('falls back to the bundled font when the field is cleared', () => {
    expect(lookup(style({ font: '   ' }))['sub-font']).toBe(DEFAULT_SUBTITLE_FONT)
  })
})
