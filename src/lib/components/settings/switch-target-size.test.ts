import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, it, expect } from 'vitest'

// The enable/disable switches are fixed-geometry pills (a 36 x 20 track with a round knob).
// `.a11y-large-targets` (Settings -> Interface -> "Larger interaction targets") puts a 44px
// floor on BOTH axes of every `[data-focusable]`, which squares a 36 x 20 pill into a 44 x 44
// `rounded-full` box — i.e. the slider turns into a solid accent-coloured circle. This suite
// pins the geometry contract: no stylesheet rule may impose a box minimum on a switch track,
// and the 44px pointer target the setting promises has to come from somewhere else.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const appCss = read('../../../app.css')

/** Files that render a switch track, and the source of each. */
const SWITCH_SOURCES: Array<[string, string]> = [
  ['Toggle.svelte', read('./Toggle.svelte')],
  ['SettingsSwitch.svelte', read('./SettingsSwitch.svelte')],
  ['settings/sources/+page.svelte', read('../../../routes/app/settings/sources/+page.svelte')],
  ['settings/extensions/+page.svelte', read('../../../routes/app/settings/extensions/+page.svelte')],
]

/** The shared switch-track class recipe: a pill track with a knob inside. */
const TRACK_RECIPE = /class="[^"]*\binline-flex\b[^"]*\bshrink-0 items-center rounded-full transition-colors\b/g

/**
 * The whole opening tag containing `index`. Naive `[^>]*>` does not work here: Svelte
 * attributes hold arrow functions (`onclick={() => toggle(url)}`), so `>` appears inside
 * the tag. Track quotes and brace depth instead.
 */
function openingTagAt(source: string, index: number): string {
  const start = source.lastIndexOf('<', index)
  let depth = 0
  let quote = ''
  let i = start + 1
  for (; i < source.length; i++) {
    const char = source[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) break
  }
  return source.slice(start, i + 1)
}

/** Opening tags that carry the shared switch-track class recipe. */
function switchTrackTags(source: string): string[] {
  return [...source.matchAll(TRACK_RECIPE)].map((match) => openingTagAt(source, match.index))
}

// ---------------------------------------------------------------------------
// A very small CSS "would this rule ever apply to this element" checker. Only the
// subject (right-most) compound is evaluated: every ancestor part in these rules is a
// class on <html>, so it is always satisfiable.
// ---------------------------------------------------------------------------
interface Element { tag: string; classes: Set<string>; attrs: Record<string, string> }

const TOKEN =
  /\*|\[[^\]]*\]|\.[\w-]+|#[\w-]+|::[\w-]+|:not\([^()]*\)|:[\w-]+(?:\([^()]*\))?|[a-zA-Z][\w-]*/g

function matchesCompound(compound: string, el: Element): boolean {
  const tokens = compound.match(TOKEN) ?? []
  return tokens.every((token) => {
    if (token === '*' || token.startsWith('::')) return true
    if (token.startsWith('.')) return el.classes.has(token.slice(1))
    if (token.startsWith('#')) return false
    if (token.startsWith('[')) {
      const [, name, , value] = /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*['"]?([^'"\]]*)['"]?)?\s*\]/.exec(token) ?? []
      if (!name) return false
      if (!(name in el.attrs)) return false
      return value === undefined || el.attrs[name] === value
    }
    if (token.startsWith(':not(')) return !matchesCompound(token.slice(5, -1), el)
    if (token.startsWith(':')) return true // :focus / :hover / :focus-visible — reachable state
    return el.tag === token
  })
}

/** Right-most compound of a complex selector (after the last combinator). */
const subjectCompound = (selector: string) => selector.trim().split(/\s*[>+~]\s*|\s+/).pop() ?? ''

/** Every rule in app.css that sets a box minimum, paired with its subject compound. */
function boxMinimumSubjects(): Array<{ selector: string; subject: string; decls: string }> {
  const found: Array<{ selector: string; subject: string; decls: string }> = []
  postcss.parse(appCss).walkRules((rule) => {
    const decls = rule.nodes
      .filter((node) => node.type === 'decl' && /^min-(width|height)$/.test(node.prop))
      .map((node) => `${(node as postcss.Declaration).prop}: ${(node as postcss.Declaration).value}`)
    if (!decls.length) return
    for (const selector of rule.selectors) found.push({ selector, subject: subjectCompound(selector), decls: decls.join('; ') })
  })
  return found
}

const switchTrack: Element = {
  tag: 'button',
  classes: new Set(['relative', 'inline-flex', 'h-5', 'w-9', 'shrink-0', 'items-center', 'rounded-full', 'transition-colors', 'bg-theme']),
  attrs: { 'data-focusable': '', 'data-switch': '', 'aria-pressed': 'true', title: 'Disable' },
}
const plainControl: Element = {
  tag: 'button',
  classes: new Set(['rounded-md', 'px-3', 'py-2']),
  attrs: { 'data-focusable': '' },
}

describe('switch track geometry', () => {
  it('marks every switch track with data-switch', () => {
    for (const [name, source] of SWITCH_SOURCES) {
      const tracks = switchTrackTags(source)
      expect(tracks.length, `${name} should render at least one switch track`).toBeGreaterThan(0)
      for (const tag of tracks) expect(tag, `${name}: switch track is missing data-switch`).toContain('data-switch')
    }
  })

  it('never lets a stylesheet rule impose a box minimum on a switch track', () => {
    const offenders = boxMinimumSubjects().filter((rule) => matchesCompound(rule.subject, switchTrack))
    expect(
      offenders.map((rule) => `${rule.selector} { ${rule.decls} }`),
      'a min-width/min-height on the track squares the pill into a circle',
    ).toEqual([])
  })

  it('still gives ordinary focusable controls the 44px minimum the setting promises', () => {
    const applied = boxMinimumSubjects().filter((rule) => matchesCompound(rule.subject, plainControl))
    expect(applied.length).toBeGreaterThan(0)
    expect(applied.every((rule) => rule.decls.includes('44px'))).toBe(true)
  })

  it('gives switch tracks a 44px pointer target via an overlay instead', () => {
    let overlay: postcss.Rule | undefined
    postcss.parse(appCss).walkRules((rule) => {
      if (rule.selectors.some((selector) => /\[data-switch\][^\s]*::after$/.test(selector.trim()))) overlay = rule
    })
    expect(overlay, 'expected a [data-switch]::after hit-area rule').toBeDefined()
    const css = overlay!.toString()
    expect(css).toMatch(/width:\s*44px/)
    expect(css).toMatch(/height:\s*44px/)
    expect(css).toMatch(/position:\s*absolute/)
  })
})
