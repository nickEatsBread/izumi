import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { hasAttr, markupElements, markupElementsFromSource, staticAttr, type MarkupElement } from '../../test/svelte-markup'

// Deck and controller focus ring (spec §4 "Focus ring", owner decision 9). One two-tone ring built
// from the theme's tokens for Game mode and controller mode; the player keeps its white ring; the
// Android TV rings are untouched; Theme Studio and the install preview keep their editor palette;
// and no inline style or component rule hides the ring from a d-pad user.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const css = read('../../app.css')
const sheet = postcss.parse(css)

const RING = 'var(--izumi-safe-focus-ring)'
const RING_VALUE =
  '0 0 0 2px hsl(var(--izumi-safe-background, var(--background))), ' +
  '0 0 0 5px hsl(var(--ring, var(--izumi-safe-foreground, var(--foreground)))), ' +
  '0 0 0 6px hsl(var(--izumi-safe-foreground, var(--foreground)) / 0.55)'
/** How far the ring reaches outside the element, in px: its widest spread. */
const RING_REACH = Math.max(...[...RING_VALUE.matchAll(/0 0 0 (\d+)px/g)].map((match) => Number(match[1])))
/** The only prefix under which a component may drop a focused field's ring: no controller drives the page. */
const CONTROLLER_FREE = ':global(html:not(.gamemode):not(.controller-mode):not(.tv-mode))'

/** Values of `prop` in the top-level rules (not inside @media) whose selector list is exactly `selector`. */
function declared(selector: string, prop: string, root: postcss.Root = sheet): string[] {
  const values: string[] = []
  root.walkRules((rule) => {
    if (rule.parent?.type !== 'root' || rule.selectors.join(', ') !== selector) return
    rule.walkDecls(prop, (decl) => { values.push(decl.value) })
  })
  return values
}

/** Every <style> block of a component's source, in order (a component may also carry one in <svelte:head>). */
function styleBlocks(source: string): string[] {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1])
}

/** All of a component's <style> blocks, parsed as one sheet. */
function componentStyle(relative: string): postcss.Root {
  const blocks = styleBlocks(read(relative))
  expect(blocks.length, `${relative} has a <style> block`).toBeGreaterThan(0)
  return postcss.parse(blocks.join('\n'))
}

/** Splits `value` on `separator` outside parentheses. */
function splitTopLevel(value: string, separator: RegExp): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth--
    if (depth === 0 && separator.test(char)) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|r?em|%|v[wh]|ch)?$/i
/** `transparent`, a zero-alpha hex, or a colour function whose alpha (`/ 0`, or a fourth comma argument) is zero. */
function isTransparent(colour: string): boolean {
  const lower = colour.toLowerCase()
  if (/^(?:transparent|#[0-9a-f]{3}0|#[0-9a-f]{6}00)$/.test(lower)) return true
  const inner = /^[a-z-]+\((.*)\)$/.exec(lower)?.[1]
  if (inner === undefined) return false
  const slashed = splitTopLevel(inner, /\//)
  const commas = splitTopLevel(inner, /,/)
  const alpha = slashed.length === 2 ? slashed[1] : commas.length === 4 ? commas[3] : undefined
  return alpha !== undefined && /^(?:0+(?:\.0*)?|\.0+)%?$/.test(alpha)
}
/** True when a `box-shadow` value paints nothing: `none`, a CSS-wide keyword, or only layers that
 *  are all zero lengths or a transparent colour (`0 0 #0000`, `0 0 0 0 transparent`, `… rgb(0 0 0 / 0)`).
 *  A layer that is a bare var() cannot be judged here and counts as painting. */
function shadowPaintsNothing(value: string): boolean {
  const trimmed = value.trim()
  if (/^(?:none|initial|unset|inherit|revert|revert-layer)$/i.test(trimmed)) return true
  return splitTopLevel(trimmed, /,/).every((layer) => {
    const tokens = splitTopLevel(layer, /\s/)
    if (tokens.some((token) => /^var\(/i.test(token))) return false
    const lengths = tokens.filter((token) => LENGTH.test(token))
    const colour = tokens.find((token) => token.toLowerCase() !== 'inset' && !LENGTH.test(token))
    if (colour && isTransparent(colour)) return true
    return lengths.length >= 2 && lengths.every((length) => Number.parseFloat(length) === 0)
  })
}

/** Selectors in `style` that take the box-shadow away from a focused control (or one inside a
 *  focused wrapper) on a page a controller may drive. */
function ringDrops(style: string): string[] {
  const offenders: string[] = []
  postcss.parse(style).walkRules((rule) => {
    const drops = rule.nodes.some((node) => node.type === 'decl' && node.prop.toLowerCase() === 'box-shadow' && shadowPaintsNothing(node.value))
    if (!drops) return
    for (const selector of rule.selectors) {
      if (/:focus(?:-visible|-within)?(?![\w-])/.test(selector) && !selector.startsWith(CONTROLLER_FREE)) offenders.push(selector)
    }
  })
  return offenders
}

/** `data-focusable` elements that set a box-shadow inline (an inline style beats every ring rule):
 *  `style:box-shadow`, or a `style` attribute that mentions box-shadow in its text or its expression. */
function inlineRingOverrides(elements: readonly MarkupElement[]): string[] {
  const offenders: string[] = []
  for (const el of elements) {
    if (!hasAttr(el, 'data-focusable')) continue
    for (const attribute of el.attrs) {
      if (attribute.name === 'style:box-shadow') offenders.push(`${el.file}:${el.line} ${attribute.raw}`)
      if (attribute.name === 'style' && /box-shadow|boxShadow/.test(attribute.raw)) offenders.push(`${el.file}:${el.line} ${attribute.raw}`)
    }
  }
  return offenders
}

/** The smallest root font size, in px: a phone's 14.5 px (app.css) at the lowest theme font scale,
 *  0.85 (settings/theme-studio.ts). The ring is drawn in px, so rem-only room shrinks under it. */
const SMALLEST_ROOT_PX = 14.5 * 0.85
/** The least block padding (top or bottom, any breakpoint) a Tailwind class list guarantees, in px:
 *  a spacing step is rem, so only a px term (`py-[6px]`, `py-[max(0.375rem,6px)]`) holds at any root. */
function blockPadding(classes: string): number {
  const values = classes.split(/\s+/).flatMap((token) => {
    const match = /^(?:[a-z-]+:)*(?:p|py|pt|pb)-(?:(\d+(?:\.\d+)?)|\[(.+)\])$/.exec(token)
    if (!match) return []
    if (match[1]) return [Number(match[1]) * 0.25 * SMALLEST_ROOT_PX]
    const terms = [...match[2].matchAll(/([\d.]+)(px|rem)/g)].map(([, size, unit]) => Number(size) * (unit === 'px' ? 1 : SMALLEST_ROOT_PX))
    return [match[2].startsWith('max(') ? Math.max(...terms) : Math.min(...terms)]
  })
  return values.length ? Math.min(...values) : 0
}

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const svelteFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.svelte'))
  .map((file) => join(SRC, file))
const textOf = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

describe('Deck and controller focus ring', () => {
  it('defines one two-tone ring from the theme tokens on the root and on protected surfaces', () => {
    expect(declared(':root, [data-theme-protected]', '--izumi-safe-focus-ring')).toEqual([RING_VALUE])
    // The band is the theme's --ring with a foreground fallback; the gap and the hairline read the
    // client-owned palette mirror (theme.ts), which a theme stylesheet cannot declare (css-policy.ts).
    const [ring] = declared(':root, [data-theme-protected]', '--izumi-safe-focus-ring')
    expect(ring).toContain('hsl(var(--ring, var(--izumi-safe-foreground, var(--foreground))))')
    // A custom property resolves its var()s where it is declared: on a protected surface --ring is
    // the mirror, so the band follows --izumi-safe-ring there instead of the root's value.
    expect(declared('[data-theme-protected]', '--ring')).toEqual(['var(--izumi-safe-ring)'])
  })

  it('rings every Game-mode and controller-mode focus with the variable', () => {
    expect(declared('.gamemode [data-focusable]:focus', 'box-shadow')).toEqual([RING])
    expect(declared('.gamemode [data-focusable]:focus .focus-cover', 'box-shadow')).toEqual([RING])
    expect(declared('.controller-mode [data-focusable]:focus', 'box-shadow')).toEqual([`${RING}, 0 8px 24px rgb(0 0 0 / 0.4)`])
    expect(declared('.controller-mode [data-focusable]:focus .focus-cover', 'box-shadow')).toEqual([`${RING}, 0 10px 28px rgb(0 0 0 / 0.5)`])
  })

  it('never paints a white ring in a Game-mode or controller-mode focus rule outside the player', () => {
    const offenders: string[] = []
    sheet.walkRules((rule) => {
      const ringed = rule.selectors.filter((selector) =>
        /\.(gamemode|controller-mode)\b/.test(selector) && selector.includes(':focus')
        && !/\.izumi-player-root|\.player-shell/.test(selector))
      if (!ringed.length) return
      rule.walkDecls('box-shadow', (decl) => {
        if (/#fff\b|#ffffff\b|\bwhite\b|rgba?\(\s*255[\s,]+255[\s,]+255/i.test(decl.value)) offenders.push(`${ringed.join(', ')} { box-shadow: ${decl.value} }`)
      })
    })
    expect(offenders).toEqual([])
  })
})

describe('surfaces that keep their own ring', () => {
  it('keeps the player ring white over video', () => {
    expect(declared('.izumi-player-root, .player-shell', '--izumi-safe-focus-ring')).toEqual(['0 0 0 3px #fff'])
    expect(declared('.gamemode .izumi-player-root .gm-play.focus-ring-inset:focus', 'box-shadow')).toEqual(['0 0 0 3px #fff, 0 10px 28px rgba(0, 0, 0, 0.4)'])
  })

  it('leaves the Android TV rings as they are', () => {
    expect(declared('.tv-mode [data-focusable]:focus', 'box-shadow')).toEqual(['0 0 0 4px #fff, 0 8px 28px rgb(0 0 0 / 0.45)'])
    expect(declared('.tv-mode [data-focusable]:focus .focus-cover', 'box-shadow')).toEqual(['0 0 0 4px #fff, 0 12px 32px rgb(0 0 0 / 0.55)'])
    expect(declared('.tv-mode .player-shell button:focus, .tv-mode .player-shell [role="slider"]:focus', 'box-shadow')).toEqual(['0 0 0 4px #fff, 0 8px 28px rgb(0 0 0 / 0.55)'])
    const tvRules: string[] = []
    sheet.walkRules((rule) => {
      if (rule.selectors.some((selector) => selector.includes('.tv-mode')) && rule.toString().includes('--izumi-safe-focus-ring')) tvRules.push(rule.selector)
    })
    expect(tvRules).toEqual([])
  })
})

describe('editor surfaces keep their own palette', () => {
  it('rings Theme Studio and the install preview in their editor colours, never the theme being edited', () => {
    expect(declared('.studio-panel, .studio-resume', '--izumi-safe-focus-ring', componentStyle('../components/settings/ThemeStudio.svelte')))
      .toEqual(['0 0 0 2px var(--editor-bg), 0 0 0 5px var(--editor-focus)'])
    expect(declared('.theme-preview-bar', '--izumi-safe-focus-ring', componentStyle('../components/themes/ThemeInstallPreview.svelte')))
      .toEqual(['0 0 0 2px var(--recovery-bg), 0 0 0 5px var(--recovery-focus)'])
  })
})

describe('room for the ring in carousel rows', () => {
  it('raises the Game-mode and controller-mode track padding so a popped cover keeps its whole ring', () => {
    expect(declared('html.gamemode [data-carousel-scroller], html.controller-mode [data-carousel-scroller]', 'padding-top'))
      .toEqual(['max(1.125rem, 18px)'])
    // deck-touch-scroll.test.ts reads the FIRST `.gamemode [data-carousel-scroller]` in app.css for `overflow: hidden`.
    const overflow = css.indexOf('.gamemode [data-carousel-scroller] { overflow: hidden; }')
    expect(overflow).toBeGreaterThan(-1)
    expect(css.indexOf('html.gamemode [data-carousel-scroller]')).toBeGreaterThan(overflow)
  })
})

describe('room for the ring in the search dialogs', () => {
  // Both dialogs clip (`overflow-hidden rounded-2xl`) and open with the field focused, flush under
  // the dialog's top edge. The header row's block padding holds the whole ring; the field paints
  // above the results panel that follows the row (Game mode does not position a focused control).
  it.each([
    ['../components/settings/SettingsSearch.svelte', 'settings-search-input'],
    ['../components/search/GlobalSearch.svelte', 'global-search-input'],
  ])('%s keeps the whole ring of its field inside the dialog', (relative, fieldClass) => {
    const elements = markupElements(fileURLToPath(new URL(relative, import.meta.url)))
    const field = elements.find((el) => el.name === 'input' && staticAttr(el, 'class')?.split(/\s+/).includes(fieldClass))
    expect(field, `${relative} has the .${fieldClass} input`).toBeTruthy()
    const dialog = field!.ancestors.find((el) => staticAttr(el, 'role') === 'dialog')
    expect(staticAttr(dialog!, 'class')?.split(/\s+/)).toContain('overflow-hidden')
    const row = field!.ancestors[0]
    expect(blockPadding(staticAttr(row, 'class') ?? ''), `${relative} header row block padding`).toBeGreaterThanOrEqual(RING_REACH)
    expect(staticAttr(field!, 'class')?.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'z-10']))
  })

  it('counts only px-floored room as room for the px ring', () => {
    expect(blockPadding('px-3 py-[max(0.375rem,6px)]')).toBe(6)
    expect(blockPadding('py-[6px] sm:pt-[8px]')).toBe(6)
    expect(blockPadding('px-3 py-1.5')).toBeLessThan(RING_REACH) // 0.375rem is 4.6 px at the smallest root
    expect(blockPadding('px-3')).toBe(0)
  })
})

describe('nothing hides the ring from a d-pad user', () => {
  it('lets the settings search field keep its ring under a controller', () => {
    expect(read('../components/settings/SettingsSearch.svelte')).not.toMatch(/style="[^"]*box-shadow/)
    const selectors: string[] = []
    componentStyle('../components/settings/SettingsSearch.svelte').walkRules((rule) => {
      if (rule.selector.includes('.settings-search-input')) selectors.push(...rule.selectors)
    })
    expect(selectors).toEqual([
      `${CONTROLLER_FREE} .settings-search-input:focus`,
      `${CONTROLLER_FREE} .settings-search-input:focus-visible`,
    ])
  })

  it('never sets an inline box-shadow on a data-focusable element', () => {
    const candidates = svelteFiles.filter((file) => {
      const text = textOf(file)
      return text.includes('data-focusable') && /box-shadow|boxShadow/.test(text)
    })
    expect(candidates.flatMap((file) => inlineRingOverrides(markupElements(file)))).toEqual([])
  }, 20_000) // reads every component in src and parses the candidates: ~0.3 s alone, far longer in a full parallel run

  it('never lets a component style drop the ring of a focused control while a controller drives the page', () => {
    const offenders = svelteFiles
      .filter((file) => /box-shadow/i.test(textOf(file)))
      .flatMap((file) => styleBlocks(textOf(file)).flatMap((style) => ringDrops(style).map((selector) => `${file}: ${selector}`)))
    expect(offenders).toEqual([])
  }, 20_000) // reads every component in src

  // The two guards above pass on a clean tree; these fixtures show they still catch each way a ring can go.
  it('treats every paint-nothing shadow as a drop and a real ring as none', () => {
    for (const value of ['none', 'unset', '0 0 #0000', '0 0 0 0 transparent', '0 0 0 0 #000', '0 0 0 3px rgb(0 0 0 / 0)', '0 0 0 3px hsl(var(--ring) / 0)', '0 0 #0000, 0 0 0 0 transparent']) {
      expect(shadowPaintsNothing(value), value).toBe(true)
    }
    for (const value of [RING, '0 0 0 3px #fff', 'inset 0 0 0 3px rgba(0, 0, 0, 0.4)', '0 0 #0000, 0 0 0 2px red', '0 0 0 3px hsl(var(--ring) / 0.5)', 'var(--tw-ring-shadow)']) {
      expect(shadowPaintsNothing(value), value).toBe(false)
    }
  })

  it('flags a drop on a focused control, inside a focused wrapper, or in a later style block', () => {
    const style = [
      '.a:focus { box-shadow: none }',
      '.b:focus-visible { box-shadow: 0 0 #0000 }',
      '.c:focus-within .field { box-shadow: 0 0 0 0 transparent }',
      '.d:has(:focus) input { box-shadow: unset }',
      ':global(.e:focus) { box-shadow: none !important }',
      `${CONTROLLER_FREE} .ok:focus { box-shadow: none }`,
      '.ok:hover { box-shadow: none }',
      '.ok:focus { box-shadow: 0 0 0 3px hsl(var(--ring)) }',
      '.ok:focusable { box-shadow: none }',
    ].join('\n')
    expect(ringDrops(style)).toEqual(['.a:focus', '.b:focus-visible', '.c:focus-within .field', '.d:has(:focus) input', ':global(.e:focus)'])
    const source = '<div></div>\n<style>.x { color: red }</style>\n<svelte:head><style>.y:focus { box-shadow: none }</style></svelte:head>'
    expect(styleBlocks(source).flatMap(ringDrops)).toEqual(['.y:focus'])
  })

  it('flags an inline box-shadow written as text, an expression or a style directive', () => {
    const source = [
      '<script>import { toStyle } from "./style"; let shadow = $state("none"); let css = $state("")</script>',
      '<button data-focusable style="box-shadow:none">a</button>',
      '<button data-focusable style={`box-shadow: ${shadow}`}>b</button>',
      '<button data-focusable style="color: red; box-shadow: {shadow}">c</button>',
      '<button data-focusable style:box-shadow={shadow}>d</button>',
      '<button data-focusable style={toStyle({ boxShadow: shadow })}>e</button>',
      '<button data-focusable style={css}>ok: a bare expression cannot be judged</button>',
      '<button style="box-shadow:none">ok: not a d-pad stop</button>',
    ].join('\n')
    expect(inlineRingOverrides(markupElementsFromSource(source, 'fixture.svelte')).map((offender) => offender.split(' ')[0]))
      .toEqual(['fixture.svelte:2', 'fixture.svelte:3', 'fixture.svelte:4', 'fixture.svelte:5', 'fixture.svelte:6'])
  })
})
