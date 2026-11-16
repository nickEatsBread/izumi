// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeRules, sanitizeThemeCss, themeStyleText } from './css'

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
    expect(themeStyleText(result, false)).toMatch(/^@keyframes[\s\S]*\.g \{/)
    expect(themeStyleText(result, false)).not.toContain('@scope')
  })
  it('rewrites :scope to :root in the plain rules through the parsed selectors', () => {
    const result = sanitizeThemeCss(':scope{--a:1px} :scope[data-surface="tv"] .x{color:red} .b{ :scope.dark &{color:blue} } @media (min-width:1px){:scope .m{color:green}} .y:is(:scope .z){color:teal} [title=":scope"]{color:gray} @scope (.s){:scope{color:pink}}')
    if (result.error !== undefined) throw new Error(result.error)
    const plain = result.plain.replace(/\s+/g, ' ')
    for (const selector of [':root { --a: 1px; }', ':root[data-surface="tv"] .x {', ':root.dark & {', ':root .m {', '.y:is(:root .z) {']) expect(plain).toContain(selector)
    // Strings stay as written, and a theme's own @scope keeps the :scope naming its root.
    expect(plain).toContain('[title=":scope"] {')
    expect(plain).toContain('@scope (.s) { :scope { color: pink; } }')
    // The scoped form keeps every :scope: inside the wrapper it already names the root.
    expect(result.css).not.toContain(':root')
    expect(themeStyleText(result, true)).toContain(':scope[data-surface="tv"] .x')
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
  it('emits the plain rules while no protected surface is mounted, and the @scope wrapper while one is', () => {
    const result = { css: ':scope { --a: 1px; }', plain: ':root { --a: 1px; }', global: '' }
    expect(themeStyleText(result, false)).toBe(':root { --a: 1px; }')
    expect(themeStyleText(result, true)).toBe('@scope (:root) to ([data-theme-protected], [data-theme-unthemed]) {\n:scope { --a: 1px; }\n}')
  })
})
