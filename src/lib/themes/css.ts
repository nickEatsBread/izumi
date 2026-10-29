import { BLOCKED_PROPERTIES, RESERVED_PROPERTY_PREFIX, THEME_CSS_MAX_BYTES, THEME_CSS_MAX_DEPTH, THEME_CSS_MAX_RULES, forbiddenCss } from './css-policy'

/** `global` holds rules that must live outside `@scope` (keyframes, layer statements). `plain` is `css`
 *  for use without the `@scope (:root)` wrapper: its `:scope` selectors name `:root` instead. */
export type SanitizedCss = { css: string; plain: string; global: string; error?: undefined }
  | { css?: undefined; plain?: undefined; global?: undefined; error: string }
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

// A `:scope` pseudo-class in serialized selector text; strings and escapes are matched first so they're skipped.
const SCOPE_PSEUDO = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\\[\s\S]|(:scope)(?![\w-])/gi

/** Inside the wrapper `:scope` is the root element; unwrapped it becomes `:root`. A theme's own `@scope`
 *  rules keep theirs, which name their own root. Rewrites the parsed selectors in place. */
function scopeToRoot(owner: { cssRules: CSSRuleList }): void {
  for (const rule of Array.from(owner.cssRules)) {
    if (kind(rule) === 'CSSScopeRule') continue
    if (kind(rule) === 'CSSStyleRule') {
      const style = rule as CSSStyleRule
      const selector = style.selectorText.replace(SCOPE_PSEUDO, (match, scope?: string) => (scope ? ':root' : match))
      if (selector !== style.selectorText) style.selectorText = selector
    }
    const nested = rule as unknown as Partial<RuleOwner>
    if (nested.cssRules) scopeToRoot(nested as RuleOwner)
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
    const body = () => rules.filter(rule => !GLOBAL.has(kind(rule))).map(rule => rule.cssText).join('\n')
    const css = body()
    scopeToRoot(sheet)
    const plain = body()
    const global = rules.filter(rule => GLOBAL.has(kind(rule))).map(rule => rule.cssText).join('\n')
    const problem = forbiddenCss(`${global}\n${css}\n${plain}`)
    return problem ? { error: problem } : { css, plain, global }
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

/** `scoped` while a protected surface is mounted: then the theme can never match inside `[data-theme-protected]`
 *  subtrees, nor inside `[data-theme-unthemed]` ones (Game mode's player, whose HUD is measured from the DOM).
 *  Otherwise plain rules: WebKit restyles a page about three times faster without the wrapper. */
export function themeStyleText(result: { css: string; plain: string; global: string }, scoped: boolean): string {
  const body = scoped ? `@scope (:root) to ([data-theme-protected], [data-theme-unthemed]) {\n${result.css}\n}` : result.plain
  return result.global ? `${result.global}\n${body}` : body
}
