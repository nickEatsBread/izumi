// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// The controller row highlight in app.css, run against DOM shaped like SettingsRow's output. The
// selectors are read from app.css, so these check what the shipped rules match when a control has
// focus (jsdom's selector engine handles :focus, :has() with relative selectors and :is()).
// A path: new URL(…, import.meta.url) fails node's file-scheme check at module load under jsdom.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../app.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rowRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }))
  .filter((rule) => rule.selector.includes('[data-setting-row]'))
const kinds = {
  ring: rowRules.filter((rule) => /box-shadow: (?!none)/.test(rule.body)),
  fill: rowRules.filter((rule) => rule.body.includes('background-color: hsl(var(--foreground) / 0.1)')),
  noRing: rowRules.filter((rule) => rule.body.includes('box-shadow: none')),
  noFill: rowRules.filter((rule) => rule.body.includes('background-color: transparent')),
}
/** Which of the row rules' effects reach `el` right now. */
const styles = (el: Element) => Object.entries(kinds).filter(([, rules]) => rules.some((rule) => el.matches(rule.selector))).map(([kind]) => kind)

// SettingsRow.svelte's three root shapes: a row button (onActivate), a link row (href) and a control
// row, whose header line ([data-nav-line]) holds the control snippet. Learn more and the expanded
// children follow the header inside the root.
type Extra = { key?: string; learnMore?: string; children?: string }
const tail = ({ learnMore, children }: Extra) =>
  `${learnMore ? `<div data-learn-more><p>${learnMore}</p></div>` : ''}${children ? `<div>${children}</div>` : ''}`
const root = (key?: string) => `<div data-setting-row${key ? ` data-setting-key="${key}"` : ''}>`
const buttonRow = (title: string, extra: Extra = {}) =>
  `${root(extra.key)}<button type="button" data-focusable data-row-activate><div data-nav-line>${title}</div></button>${tail(extra)}</div>`
const linkRow = (title: string, extra: Extra = {}) =>
  `${root(extra.key)}<a href="#x" data-focusable><div data-nav-line>${title}</div></a>${tail(extra)}</div>`
const controlRow = (title: string, controls: string, extra: Extra = {}) =>
  `${root(extra.key)}<div data-nav-line><div>${title}</div><div>${controls}</div></div>${tail(extra)}</div>`
const trigger = (label: string) => `<button type="button" data-focusable data-nav-measure-row>${label}</button>`
const action = (label: string) => `<button type="button" data-focusable>${label}</button>`

const mount = (html: string) => { document.body.innerHTML = `<div data-settings-controller>${html}</div>` }
const control = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-focusable]')].find((el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label)!
const rowOf = (label: string) => control(label).closest('[data-setting-row]')!
const block = (key: string) => document.querySelector(`[data-setting-key="${key}"]`)!

afterEach(() => {
  document.documentElement.className = ''
  document.body.replaceChildren()
})

it('reads one ring rule per controller surface and one rule for each other effect from app.css', () => {
  expect(kinds.ring.map((rule) => rule.selector.split(' ')[0])).toEqual(['.gamemode', '.controller-mode', '.tv-mode'])
  expect([kinds.fill, kinds.noRing, kinds.noFill].map((rules) => rules.length)).toEqual([1, 1, 1])
})

describe.each(['gamemode', 'controller-mode', 'tv-mode'])('the controller row highlight (%s)', (mode) => {
  it('lights only the focused row, not a [data-setting-key] block wrapping several rows', () => {
    document.documentElement.className = mode
    // Settings › Playback's GIF block: one data-setting-key around three rows.
    mount(`<div data-setting-key="gif-recorder">
      ${buttonRow('Include subtitles in GIFs', { key: 'include-subtitles-in-gifs', learnMore: 'Unencrypted playback cuts the file.' })}
      ${controlRow('GIF width', trigger('480px'), { key: 'gif-width' })}
      ${buttonRow('Auto-hide', { key: 'auto-hide' })}
    </div>`)
    control('480px').focus()
    expect(styles(rowOf('480px'))).toEqual(['ring', 'fill'])
    expect(styles(block('gif-recorder'))).toEqual([])
    expect(styles(rowOf('Include subtitles in GIFs'))).toEqual([])
    // Alone on its line, the trigger drops its own ring and fill under the row's.
    expect(styles(control('480px'))).toEqual(['noRing', 'noFill'])

    control('Include subtitles in GIFs').focus()
    expect(styles(rowOf('Include subtitles in GIFs'))).toEqual(['ring', 'fill'])
    expect(styles(control('Include subtitles in GIFs'))).toEqual(['noRing', 'noFill'])
    expect(styles(block('gif-recorder'))).toEqual([])
    expect(styles(rowOf('480px'))).toEqual([])

    // A row button with no Learn more holds the whole row already: it keeps its own ring.
    control('Auto-hide').focus()
    expect(styles(rowOf('Auto-hide'))).toEqual([])
    expect(styles(control('Auto-hide'))).toEqual([])
  })

  it('lights a row for its header only: expanded children and a row nested in them keep their own ring', () => {
    document.documentElement.className = mode
    mount(`
      ${controlRow('Stremio', action('Manage') + action('Connect'), {
        key: 'stremio-account',
        learnMore: 'Add-ons sync both ways.',
        children: `<div>${action('Sync now')}${action('Disconnect')}</div>${controlRow('Nested', action('Nested action'))}`,
      })}
      ${buttonRow('Kitsu', { learnMore: 'Signs in once.', children: '<input data-focusable aria-label="Username">' })}`)
    control('Manage').focus()
    expect(styles(rowOf('Manage'))).toEqual(['ring', 'fill'])
    // Two controls on one line: the focused one drops its ring but keeps its fill.
    expect(styles(control('Manage'))).toEqual(['noRing'])

    control('Sync now').focus()
    expect(styles(rowOf('Manage'))).toEqual([])
    expect(styles(control('Sync now'))).toEqual([])

    control('Nested action').focus()
    expect(styles(rowOf('Nested action'))).toEqual(['ring', 'fill'])
    expect(styles(rowOf('Manage'))).toEqual([])

    control('Username').focus()
    expect(styles(rowOf('Username'))).toEqual([])
    expect(styles(control('Username'))).toEqual([])
  })

  it('lights a row without a settingKey for its Learn more like a keyed one', () => {
    document.documentElement.className = mode
    mount(`
      ${linkRow('Restore from TV', { learnMore: 'Brings the TV setup here.' })}
      ${controlRow('Restore application backup', action('Choose file'), { learnMore: 'Overwrites matching settings.' })}`)
    control('Restore from TV').focus()
    expect(styles(rowOf('Restore from TV'))).toEqual(['ring', 'fill'])
    expect(styles(control('Restore from TV'))).toEqual(['noRing', 'noFill'])

    control('Choose file').focus()
    expect(styles(rowOf('Choose file'))).toEqual(['ring', 'fill'])
    expect(styles(control('Choose file'))).toEqual(['noRing'])
    expect(styles(rowOf('Restore from TV'))).toEqual([])
  })

  it('keeps the fill of an inline trigger that shares its line, so the focused control stands out', () => {
    document.documentElement.className = mode
    // Settings › Navigation: keyless rows inside the editor's data-setting-key block, each line an
    // inline placement trigger and two move buttons.
    mount(`<div data-setting-key="navigation-items">
      ${controlRow('Search', trigger('Bottom bar') + action('Move Search up') + action('Move Search down'))}
    </div>`)
    control('Bottom bar').focus()
    expect(styles(rowOf('Bottom bar'))).toEqual(['ring', 'fill'])
    expect(styles(block('navigation-items'))).toEqual([])
    expect(styles(control('Bottom bar'))).toEqual(['noRing'])
  })
})

it('leaves desktop focus alone: no row lights and every control keeps its ring', () => {
  document.body.innerHTML = controlRow('GIF width', trigger('480px'), { learnMore: 'Height follows the video.' })
  control('480px').focus()
  expect(styles(rowOf('480px'))).toEqual([])
  expect(styles(control('480px'))).toEqual([])
})
