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

/** With `@scope` support the theme can never match inside `[data-theme-protected]` subtrees. */
export function themeStyleText(result: { css: string; global: string }, scoped: boolean): string {
  const body = scoped ? `@scope (:root) to ([data-theme-protected]) {\n${result.css}\n}` : result.css
  return result.global ? `${result.global}\n${body}` : body
}
