import { BLOCKED_PROPERTIES, RESERVED_PROPERTY_PREFIX, THEME_CSS_MAX_BYTES, THEME_CSS_MAX_DEPTH, THEME_CSS_MAX_RULES, forbiddenCss } from './css-policy'

/** `global` holds rules that must live outside `@scope` (keyframes, layer statements). */
export type SanitizedCss = { css: string; global: string; error?: undefined } | { css?: undefined; global?: undefined; error: string }
export interface RuleOwner { cssRules: CSSRuleList; deleteRule(index: number): void }

const KEPT = new Set([
  'CSSStyleRule', 'CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule', 'CSSLayerBlockRule',
  'CSSLayerStatementRule', 'CSSScopeRule', 'CSSStartingStyleRule', 'CSSKeyframesRule', 'CSSNestedDeclarations',
])
const GLOBAL = new Set(['CSSKeyframesRule', 'CSSLayerStatementRule'])
// Rule identity comes from the engine's own CSSOM objects; the threat model is untrusted CSS text, not script.
const kind = (rule: CSSRule) => rule.constructor.name

function cleanDeclarations(style: CSSStyleDeclaration): void {
  for (let index = style.length - 1; index >= 0; index--) {
    const name = style.item(index)
    const lower = name.toLowerCase()
    const value = style.getPropertyValue(name)
    const custom = lower.startsWith('--')
    if (BLOCKED_PROPERTIES.includes(lower)
      || (custom && (lower.startsWith(RESERVED_PROPERTY_PREFIX) || value.includes('\\')))
      || forbiddenCss(value)) style.removeProperty(name)
  }
}

/** Walks a rule list from the end so deletions keep earlier indexes valid. Exported for tests. */
export function sanitizeRules(owner: RuleOwner, depth: number, budget: { rules: number }): void {
  if (depth > THEME_CSS_MAX_DEPTH) throw new Error('This theme stylesheet nests too deeply.')
  for (let index = owner.cssRules.length - 1; index >= 0; index--) {
    const rule = owner.cssRules[index]
    if (++budget.rules > THEME_CSS_MAX_RULES) throw new Error('This theme stylesheet has too many rules.')
    if (!KEPT.has(kind(rule))) { owner.deleteRule(index); continue }
    if (kind(rule) === 'CSSKeyframesRule') {
      for (const frame of Array.from((rule as CSSKeyframesRule).cssRules) as CSSKeyframeRule[]) {
        if (++budget.rules > THEME_CSS_MAX_RULES) throw new Error('This theme stylesheet has too many rules.')
        cleanDeclarations(frame.style)
      }
      if (forbiddenCss(rule.cssText)) owner.deleteRule(index)
      continue
    }
    const style = (rule as Partial<CSSStyleRule>).style
    if (style) cleanDeclarations(style)
    const nested = rule as unknown as Partial<RuleOwner>
    if (nested.cssRules && typeof nested.deleteRule === 'function') sanitizeRules(nested as RuleOwner, depth + 1, budget)
    // A var() shorthand hides its longhands (they read as ""), so the rule text is checked too.
    if (forbiddenCss(rule.cssText)) owner.deleteRule(index)
  }
}

/** Parse with the webview's own CSSOM, drop what the policy forbids, and rebuild from the parsed
 *  rules. The rebuilt text is scanned again and rejected whole if anything slipped through. */
export function sanitizeThemeCss(text: string, Sheet: typeof CSSStyleSheet | null = globalThis.CSSStyleSheet ?? null): SanitizedCss {
  try {
    if (!Sheet) return { error: 'This device cannot check theme stylesheets.' }
    if (new TextEncoder().encode(text).length > THEME_CSS_MAX_BYTES) return { error: 'This theme stylesheet is over 128 KB.' }
    const sheet = new Sheet()
    sheet.replaceSync(text)
    if (Array.from(sheet.cssRules).some(rule => kind(rule) === 'CSSNamespaceRule')) return { error: 'Theme stylesheets cannot use @namespace.' }
    sanitizeRules(sheet as unknown as RuleOwner, 0, { rules: 0 })
    const rules = Array.from(sheet.cssRules)
    const css = rules.filter(rule => !GLOBAL.has(kind(rule))).map(rule => rule.cssText).join('\n')
    const global = rules.filter(rule => GLOBAL.has(kind(rule))).map(rule => rule.cssText).join('\n')
    const problem = forbiddenCss(`${global}\n${css}`)
    return problem ? { error: problem } : { css, global }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'This theme stylesheet could not be read.' }
  }
}

let last: { text: string; result: SanitizedCss } | undefined
/** `apply()` in theme.ts runs on every appearance change; re-sanitise only when the text changes. */
export function sanitizeThemeCssCached(text: string): SanitizedCss {
  if (last?.text !== text) last = { text, result: sanitizeThemeCss(text) }
  return last.result
}

/** With `@scope` support the theme can never match inside `[data-theme-protected]` subtrees, nor inside
 *  `[data-theme-unthemed]` ones (Game mode's player, whose HUD is measured from the DOM). */
export function themeStyleText(result: { css: string; global: string }, scoped: boolean): string {
  const body = scoped ? `@scope (:root) to ([data-theme-protected], [data-theme-unthemed]) {\n${result.css}\n}` : result.css
  return result.global ? `${result.global}\n${body}` : body
}

const VIEWPORT_UNITS = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|(?<![\w.#-])(-?(?:\d+\.\d+|\d+|\.\d+))[sld]?(vw|vh|vmin|vmax)(?![\w-])/gi

/** WebKitGTK zooms a `font-size` given in viewport units twice under the Deck's native page zoom: a
 *  heading of 32 units on a 1920 canvas drew at 21.3 px where Chromium draws 17.1 px, while widths in
 *  the same units are right. Game mode therefore writes a theme's viewport units as multiples of host
 *  px variables (`--izumi-safe-vw` and friends, kept equal to the viewport), which zoom once. Strings
 *  and url() stay as they are. */
export function pinViewportUnits(css: string): string {
  return css.replace(VIEWPORT_UNITS, (match, kept: string | undefined, value: string, unit: string) =>
    kept ?? `calc(${value} * var(--izumi-safe-${unit.toLowerCase()}))`)
}

const FOCUS_PSEUDO = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|:focus-within(?![\w-])|:focus(?![\w-])/gi
// The compound selector a focus pseudo-class is attached to inside a :has() argument.
const HAS_FOCUS = /((?:[a-zA-Z][\w-]*|\*)?(?:\[[^\]]*\]|[.#][\w-]+|:(?!focus)[\w-]+(?:\([^()]*\))?)*):(focus-within|focus)(?![\w-])/g

/** A compound selector the focus mirror watches for a `:has()` argument: elements on the focus path
 *  (`within`) or the focused element (`focus`) that match it carry `token` in `data-izumi-has-focus`. */
export interface FocusWatch { token: string; selector: string; kind: 'within' | 'focus' }

/** Game mode reads focus from attributes the host keeps on the focus path (themes/focus-mirror.ts):
 *  `:focus-within` and `:focus` become attribute selectors, which WebKitGTK restyles precisely. Inside
 *  a `:has()` argument each one gets its own token instead, set only on elements matching the compound
 *  it is attached to: a page-wide `:has([data-slot="nav.top"]:focus-within)` then changes only when
 *  focus enters or leaves the bar, not on every move between cards (12 ms a move otherwise, measured).
 *  `:focus-visible`, strings and url() stay as they are. */
export function mirrorFocusSelectors(css: string): { css: string; watches: FocusWatch[] } {
  const watches: FocusWatch[] = []
  const tokenFor = (selector: string, kind: FocusWatch['kind']) => {
    const known = watches.find((watch) => watch.selector === selector && watch.kind === kind)
    if (known) return known.token
    const token = `${kind === 'within' ? 'w' : 'f'}${watches.length}`
    watches.push({ token, selector, kind })
    return token
  }
  let out = ''
  let at = 0
  for (let open = css.indexOf(':has(', at); open >= 0; open = css.indexOf(':has(', at)) {
    let depth = 0
    let end = open + 4
    for (; end < css.length; end++) {
      if (css[end] === '(') depth++
      else if (css[end] === ')' && --depth === 0) break
    }
    const argument = css.slice(open + 5, end).replace(HAS_FOCUS, (match, compound: string, pseudo: string) =>
      `${compound}[data-izumi-has-focus~="${tokenFor(compound || '*', pseudo === 'focus-within' ? 'within' : 'focus')}"]`)
    out += css.slice(at, open + 5) + argument
    at = end
  }
  out += css.slice(at)
  return {
    css: out.replace(FOCUS_PSEUDO, (match, kept: string | undefined) =>
      kept ?? (match.toLowerCase() === ':focus-within' ? '[data-izumi-focus-within]' : '[data-izumi-focus]')),
    watches,
  }
}
