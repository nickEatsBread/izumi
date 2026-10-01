import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { hasAttr, markupElements } from '../../test/svelte-markup'

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

/** A component's <style> block, parsed. */
function componentStyle(relative: string): postcss.Root {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(read(relative))?.[1]
  expect(style, `${relative} has a <style> block`).toBeTruthy()
  return postcss.parse(style ?? '')
}

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const svelteFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.svelte'))
  .map((file) => join(SRC, file))
const textOf = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

describe('Deck and controller focus ring', () => {
  it('defines one two-tone ring from the theme tokens on the root', () => {
    expect(declared(':root', '--izumi-safe-focus-ring')).toEqual([RING_VALUE])
    // The band is the theme's --ring with a foreground fallback; the gap and the hairline read the
    // client-owned palette mirror (theme.ts), which a theme stylesheet cannot declare (css-policy.ts).
    const [ring] = declared(':root', '--izumi-safe-focus-ring')
    expect(ring).toContain('hsl(var(--ring, var(--izumi-safe-foreground, var(--foreground))))')
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
    const offenders: string[] = []
    const candidates = svelteFiles.filter((file) => {
      const text = textOf(file)
      return text.includes('data-focusable') && text.includes('box-shadow')
    })
    for (const file of candidates) {
      for (const el of markupElements(file)) {
        if (!hasAttr(el, 'data-focusable')) continue
        for (const attribute of el.node.attributes) {
          if (attribute.type === 'StyleDirective' && attribute.name === 'box-shadow') offenders.push(`${el.file}:${el.line} style:box-shadow`)
          if (attribute.type === 'Attribute' && attribute.name === 'style' && Array.isArray(attribute.value)) {
            const text = attribute.value.map((part) => (part.type === 'Text' ? part.data : '')).join('')
            if (text.includes('box-shadow')) offenders.push(`${el.file}:${el.line} style="${text}"`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  }, 20_000) // reads every component in src and parses the candidates: ~0.3 s alone, far longer in a full parallel run

  it('never lets a component style drop the ring of a focused control while a controller drives the page', () => {
    const offenders: string[] = []
    for (const file of svelteFiles.filter((path) => /box-shadow:\s*none/.test(textOf(path)))) {
      const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(textOf(file))?.[1]
      if (!style) continue
      postcss.parse(style).walkRules((rule) => {
        const drops = rule.nodes.some((node) => node.type === 'decl' && node.prop === 'box-shadow' && node.value === 'none')
        if (!drops) return
        for (const selector of rule.selectors) {
          if (/:focus(?:-visible)?(?![\w-])/.test(selector) && !selector.startsWith(CONTROLLER_FREE)) offenders.push(`${file}: ${selector}`)
        }
      })
    }
    expect(offenders).toEqual([])
  }, 20_000) // reads every component in src
})
