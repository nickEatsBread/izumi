/** Theme stylesheet policy shared by the package validator, the client sanitiser and the catalog CI.
 *  Pure — no DOM and no imports — so izumi-themes mirrors this file verbatim. */
export const THEME_CSS_MAX_BYTES = 128_000
export const THEME_CSS_MAX_RULES = 4_000
export const THEME_CSS_MAX_DEPTH = 8
export const THEME_CSS_MAX_DATA_URL = 32_000
/** Custom properties the client owns (the protected-surface palette). Themes may not declare them. */
export const RESERVED_PROPERTY_PREFIX = '--izumi-safe-'
export const BLOCKED_PROPERTIES: readonly string[] = ['-webkit-app-region', 'app-region', 'behavior', '-moz-binding']
export const BLOCKED_AT_RULES: readonly string[] = ['import', 'font-face', 'namespace', 'page', 'property', 'counter-style', 'font-feature-values', 'charset']

const FUNCTIONS = ['url', 'image-set', 'image', 'src', 'element', 'cross-fade', 'expression']
const DATA_URL = /url\(\s*(["']?)data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,][^"'()\\\s]*\1\s*\)/gi
const FUNCTION_CALL = new RegExp(`(^|[^a-z0-9_-])(?:-[a-z]+-)?(${FUNCTIONS.map(name => name.replace(/-/g, '\\-')).join('|')})\\s*\\(`, 'i')
const AT_RULE = /@(?:-[a-z]+-)?([a-z-]+)/gi
const RESERVED_DECLARATION = /(^|[{;\s])--izumi-safe-[a-z0-9_-]*\s*:/i

/** Resolves CSS escapes (`\75 rl`, `\000069mage`) so function names can't hide behind them. */
export function decodeCssEscapes(text: string): string {
  return text.replace(/\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-f]))/gi, (_match, hex: string | undefined, char: string | undefined) => {
    if (char !== undefined) return char
    const code = parseInt(hex ?? '0', 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
  })
}

/** Why a piece of CSS may not load, or undefined when it is clean. Small data: images are allowed.
 *  Escapes are decoded before the second scan so an escaped function name can't hide from it. */
export function forbiddenCss(text: string): string | undefined {
  const scrub = (value: string) => value.replace(DATA_URL, (match) => (match.length <= THEME_CSS_MAX_DATA_URL ? 'data-url' : match))
  if (FUNCTION_CALL.test(scrub(text))) return 'Stylesheets cannot load URLs or remote images.'
  if (FUNCTION_CALL.test(scrub(decodeCssEscapes(text)))) return 'Stylesheets cannot use escaped function names.'
  return undefined
}

/** Install-time check without a CSS parser: size, at-rules, blocked and reserved properties, and
 *  remote loads. The client's CSSOM sanitiser (css.ts) is the authority at apply time. */
export function precheckThemeCss(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A theme stylesheet must be text.')
  if (new TextEncoder().encode(value).length > THEME_CSS_MAX_BYTES) throw new Error('A theme stylesheet must be under 128 KB.')
  for (const match of value.matchAll(AT_RULE)) {
    const name = match[1].toLowerCase()
    if (BLOCKED_AT_RULES.includes(name)) throw new Error(`Theme stylesheets cannot use @${name}.`)
  }
  for (const property of BLOCKED_PROPERTIES) {
    if (new RegExp(`(^|[{;\\s])${property.replace(/-/g, '\\-')}\\s*:`, 'i').test(value)) throw new Error(`Theme stylesheets cannot set ${property}.`)
  }
  if (RESERVED_DECLARATION.test(value)) throw new Error('Theme stylesheets cannot set reserved --izumi-safe- properties.')
  const problem = forbiddenCss(value)
  if (problem) throw new Error(problem)
  return value
}
