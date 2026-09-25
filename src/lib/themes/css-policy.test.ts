import { describe, expect, it } from 'vitest'
import { THEME_CSS_MAX_BYTES, forbiddenCss, precheckThemeCss } from './css-policy'

describe('theme stylesheet policy', () => {
  it('accepts ordinary rules, small data images and escaped content strings', () => {
    const css = '[data-part="card"]{border-radius:6px;background:url(data:image/png;base64,iVBORw0KGgo=)} .x::before{content:"\\2022"}'
    expect(precheckThemeCss(css)).toBe(css)
  })
  it('rejects remote loads in every function form', () => {
    for (const value of ['url(https://example.test/a.png)', 'url( "//example.test/a.png" )', 'image-set("a.png" 1x)', '-webkit-image-set(url(a.png) 1x)', 'image("a.png")', 'src("a.png")', 'element(#x)', 'cross-fade(url(a.png), red)', 'expression(alert(1))']) {
      expect(forbiddenCss(`.a{background:${value}}`), value).toBeTruthy()
      expect(() => precheckThemeCss(`.a{background:${value}}`), value).toThrow()
    }
  })
  it('rejects escaped function names', () => {
    expect(forbiddenCss('.a{background:u\\72 l(https://x.test)}')).toMatch(/escaped/)
  })
  it('rejects blocked at-rules, properties and the reserved palette', () => {
    expect(() => precheckThemeCss('@import "x.css";')).toThrow('@import')
    expect(() => precheckThemeCss('@font-face{font-family:x}')).toThrow('@font-face')
    expect(() => precheckThemeCss('.a{-webkit-app-region:drag}')).toThrow('app-region')
    expect(() => precheckThemeCss(':root{--izumi-safe-background:0 0% 0%}')).toThrow('reserved')
  })
  it('enforces the size cap and rejects non-text', () => {
    expect(() => precheckThemeCss('a'.repeat(THEME_CSS_MAX_BYTES + 1))).toThrow('128 KB')
    expect(() => precheckThemeCss(42)).toThrow('text')
  })
  it('does not flag gradients or property names that contain "image"', () => {
    expect(forbiddenCss('.a{background-image:linear-gradient(red,blue);mask-image:radial-gradient(black,transparent)}')).toBeUndefined()
  })
})
