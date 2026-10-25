// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mirrorFocusSelectors, pinViewportUnits, sanitizeRules, sanitizeThemeCss, themeStyleText } from './css'

const flat = (css: string) => {
  const result = sanitizeThemeCss(css)
  if (result.error !== undefined) throw new Error(result.error)
  return `${result.global}\n${result.css}`.replace(/\s+/g, ' ').trim()
}

describe('theme stylesheet sanitiser', () => {
  it('keeps ordinary rules, nesting, media, scope and data images', () => {
    const out = flat('.a{color:red} .b{ .c{color:blue} } @media (min-width:10px){.d{color:green}} @scope (.x){.y{color:red}} .e{background-image:url(data:image/png;base64,iVBORw0KGgo=)}')
    expect(out).toContain('.a { color: red; }')
    expect(out).toContain('& .c { color: blue; }')
    expect(out).toMatch(/@media \(min-width: ?10px\)/)
    expect(out).toContain('@scope (.x)')
    expect(out).toContain('data:image/png;base64,iVBORw0KGgo=')
  })
  it('drops remote loads, blocked at-rules and blocked properties', () => {
    const out = flat('@import url(x.css); @font-face{font-family:x;src:url(a)} .a{color:red;background-image:url(https://e.test/a.png);-webkit-app-region:drag} .b{background-image:image-set("https://e.test/a.png" 1x)}')
    expect(out).not.toMatch(/import|font-face|https:|app-region|image-set/)
    expect(out).toContain('.a { color: red; }')
  })
  it('rejects @namespace rules instead of throwing while deleting them', () => {
    expect(sanitizeThemeCss('@namespace svg url(http://www.w3.org/2000/svg); .a{color:red}').error).toMatch(/@namespace/)
  })
  it('removes url smuggling through custom properties and the reserved palette', () => {
    expect(flat(String.raw`:root{--x: u\72 l(https://e.test); --y: url(https://e.test); --izumi-safe-background: 0 0% 0%; --ok: 1px}`)).toBe(':root { --ok: 1px; }')
  })
  it('cleans keyframes and hoists them out of the scoped block', () => {
    const result = sanitizeThemeCss('@keyframes k{from{opacity:0}to{opacity:1;background-image:url(https://e.test/a.png)}} .g{animation:k 1s}')
    if (result.error !== undefined) throw new Error(result.error)
    expect(result.global).toContain('@keyframes k')
    expect(result.global).not.toContain('https:')
    expect(result.css).toContain('.g')
    expect(themeStyleText(result, true)).toMatch(/^@keyframes[\s\S]*@scope \(:root\) to \(\[data-theme-protected\], \[data-theme-unthemed\]\) \{/)
  })
  it('deletes a rule whose serialized text still loads a URL (var() shorthands)', () => {
    const deleted: number[] = []
    const style = { length: 0, item: () => '', getPropertyValue: () => '', removeProperty: () => '' }
    const rule = { constructor: { name: 'CSSStyleRule' }, style, cssText: '.v { background: url(https://e.test/a.png) var(--a); }' }
    sanitizeRules({ cssRules: [rule] as unknown as CSSRuleList, deleteRule: (index: number) => { deleted.push(index) } }, 0, { rules: 0 })
    expect(deleted).toEqual([0])
  })
  it('rejects oversize input, too many rules and engines without CSSOM', () => {
    expect(sanitizeThemeCss('a'.repeat(128_001)).error).toMatch(/128 KB/)
    expect(sanitizeThemeCss('.a{}'.repeat(4001)).error).toMatch(/too many rules/)
    expect(sanitizeThemeCss(`@keyframes k{${'0%{opacity:0}'.repeat(4001)}}`).error).toMatch(/too many rules/)
    expect(sanitizeThemeCss('.a{}', null).error).toMatch(/cannot check/)
  })
  it('leaves the text unwrapped for engines without @scope', () => {
    expect(themeStyleText({ css: '.a { color: red; }', global: '' }, false)).toBe('.a { color: red; }')
  })
})

describe('Game mode stylesheet rewrites', () => {
  it('writes viewport units as multiples of the host px variables', () => {
    expect(pinViewportUnits('.a { font-size: calc(100vw / 1920 * 32); height: -.5dvh; width: 2.5vmin; margin: 1VMAX; }'))
      .toBe('.a { font-size: calc(calc(100 * var(--izumi-safe-vw)) / 1920 * 32); height: calc(-.5 * var(--izumi-safe-vh)); width: calc(2.5 * var(--izumi-safe-vmin)); margin: calc(1 * var(--izumi-safe-vmax)); }')
  })
  it('leaves strings, url(), identifiers and other units alone', () => {
    const css = '.a { content: "10vw"; background: url(x-10vh.png); --gap-10vw: 1px; animation-name: k5vh; width: 10vwx; height: 4rem; }'
    expect(pinViewportUnits(css)).toBe(css)
  })
  it('turns focus pseudo-classes into the focus mirror attributes, keeping :focus-visible', () => {
    const { css, watches } = mirrorFocusSelectors('.a:focus, .b:focus-within .c, .d:focus-visible, .e:is(:focus, :focus-within) { content: ":focus"; }')
    expect(css).toBe('.a[data-izumi-focus], .b[data-izumi-focus-within] .c, .d:focus-visible, .e:is([data-izumi-focus], [data-izumi-focus-within]) { content: ":focus"; }')
    expect(watches).toEqual([])
  })
  it('gives each :has() focus compound its own watch token', () => {
    const { css, watches } = mirrorFocusSelectors([
      ':root:has([data-slot="nav.top"]:focus-within) .x { opacity: .5 }',
      '.row:has(> .card:not(.off):focus) { color: red }',
      '.y:has([data-slot="nav.top"]:focus-within, :focus) { color: blue }',
    ].join('\n'))
    expect(css).toBe([
      ':root:has([data-slot="nav.top"][data-izumi-has-focus~="w0"]) .x { opacity: .5 }',
      '.row:has(> .card:not(.off)[data-izumi-has-focus~="f1"]) { color: red }',
      '.y:has([data-slot="nav.top"][data-izumi-has-focus~="w0"], [data-izumi-has-focus~="f2"]) { color: blue }',
    ].join('\n'))
    expect(watches).toEqual([
      { token: 'w0', selector: '[data-slot="nav.top"]', kind: 'within' },
      { token: 'f1', selector: '.card:not(.off)', kind: 'focus' },
      { token: 'f2', selector: '*', kind: 'focus' },
    ])
  })
})
