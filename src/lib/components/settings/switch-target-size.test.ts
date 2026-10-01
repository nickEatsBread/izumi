import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, it, expect } from 'vitest'
import { openingTagAt } from '../../../test/svelte-source'

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

/** Rules in app.css whose selector list mentions `needle`, with the @media query around them (null at top level). */
function rulesMentioning(needle: string): Array<{ selector: string; media: string | null; css: string }> {
  const found: Array<{ selector: string; media: string | null; css: string }> = []
  postcss.parse(appCss).walkRules((rule) => {
    const parent = rule.parent
    const media = parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'media' ? (parent as postcss.AtRule).params : null
    for (const selector of rule.selectors) if (selector.includes(needle)) found.push({ selector: selector.trim(), media, css: rule.toString() })
  })
  return found
}
const where = (rule: { selector: string; media: string | null }) => `${rule.media ?? 'top level'} | ${rule.selector}`
/** The touch rules live under a coarse pointer or in Game mode; the opt-in large-targets mode is separate. */
const touchContext = (rule: { selector: string; media: string | null }) =>
  rule.media === '(any-pointer: coarse)' || rule.selector.startsWith('html.gamemode')

// Decision 12: `data-touch-target` controls get a 44px floor wherever any pointer is coarse and in
// Game mode; standalone switch pills get the centred ::after hit area instead of a box minimum. Both
// are scoped `html:not(.tv-mode)`: the TV remote has no pointer and the ten-foot layout sizes itself.
describe('touch target rules', () => {
  it('puts a 44px floor on marked controls under a coarse pointer and in Game mode, never on TV', () => {
    const rules = rulesMentioning('[data-touch-target]')
    expect(rules.map(where).sort()).toEqual([
      '(any-pointer: coarse) | html:not(.tv-mode) [data-touch-target]',
      'top level | html.gamemode:not(.tv-mode) [data-touch-target]',
    ])
    for (const rule of rules) {
      expect(rule.css).toMatch(/min-width:\s*44px/)
      expect(rule.css).toMatch(/min-height:\s*44px/)
    }
  })

  it('gives standalone switch tracks the 44px overlay in the same two places, never on TV', () => {
    const overlays = rulesMentioning('[data-switch]::after').filter(touchContext)
    expect(overlays.map(where).sort()).toEqual([
      '(any-pointer: coarse) | html:not(.tv-mode) [data-focusable][data-switch]::after',
      'top level | html.gamemode:not(.tv-mode) [data-focusable][data-switch]::after',
    ])
    for (const rule of overlays) {
      expect(rule.css).toMatch(/position:\s*absolute/)
      expect(rule.css).toMatch(/width:\s*44px/)
      expect(rule.css).toMatch(/height:\s*44px/)
    }
    const hosts = rulesMentioning('[data-switch]').filter((rule) => touchContext(rule) && !rule.selector.endsWith('::after'))
    expect(hosts.map(where).sort()).toEqual([
      '(any-pointer: coarse) | html:not(.tv-mode) [data-focusable][data-switch]',
      'top level | html.gamemode:not(.tv-mode) [data-focusable][data-switch]',
    ])
    for (const rule of hosts) expect(rule.css).toMatch(/position:\s*relative/)
  })
})
