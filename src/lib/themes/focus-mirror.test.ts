// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { FOCUS_ATTRIBUTE, FOCUS_WITHIN_ATTRIBUTE, HAS_FOCUS_ATTRIBUTE, focusPath, hasFocusTokens, setFocusWatches, startFocusMirror } from './focus-mirror'

const watches = [
  { token: 'w0', selector: '[data-slot="nav.top"]', kind: 'within' as const },
  { token: 'f1', selector: 'button', kind: 'focus' as const },
]

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
  setFocusWatches([])
  document.body.innerHTML = ''
})

const marked = (attribute: string) => [...document.querySelectorAll(`[${attribute}]`)].map((node) => node.id || node.tagName)

describe('focus mirror', () => {
  it('lists the focus path innermost first, empty for the body', () => {
    document.body.innerHTML = '<div id="a"><button id="b"></button></div>'
    const button = document.getElementById('b')!
    expect(focusPath(button).map((node) => node.id || node.tagName)).toEqual(['b', 'a', 'BODY', 'HTML'])
    expect(focusPath(document.body)).toEqual([])
    expect(focusPath(null)).toEqual([])
  })

  it('gives focus watches to the focused element only, within watches to the whole path', () => {
    document.body.innerHTML = '<nav id="n" data-slot="nav.top"><button id="b"></button></nav>'
    const button = document.getElementById('b')!
    const nav = document.getElementById('n')!
    const path = focusPath(button)
    expect(hasFocusTokens(button, path, watches)).toBe('f1')
    expect(hasFocusTokens(nav, path, watches)).toBe('w0')
    expect(hasFocusTokens(nav, path, [{ token: 'x', selector: ':bad(', kind: 'within' }])).toBe('')
  })

  it('moves the attributes with focus and touches only what changed', () => {
    document.body.innerHTML = '<nav id="n" data-slot="nav.top"><button id="b1"></button></nav><main id="m"><a id="a1" href="#"></a><a id="a2" href="#"></a></main>'
    setFocusWatches(watches)
    stop = startFocusMirror()
    document.getElementById('b1')!.focus()
    expect(marked(FOCUS_ATTRIBUTE)).toEqual(['b1'])
    expect(marked(FOCUS_WITHIN_ATTRIBUTE)).toEqual(['HTML', 'BODY', 'n', 'b1'])
    expect(document.getElementById('n')!.getAttribute(HAS_FOCUS_ATTRIBUTE)).toBe('w0')
    expect(document.getElementById('b1')!.getAttribute(HAS_FOCUS_ATTRIBUTE)).toBe('f1')

    document.getElementById('a1')!.focus()
    expect(marked(FOCUS_ATTRIBUTE)).toEqual(['a1'])
    expect(marked(FOCUS_WITHIN_ATTRIBUTE)).toEqual(['HTML', 'BODY', 'm', 'a1'])
    expect(marked(HAS_FOCUS_ATTRIBUTE)).toEqual([])

    const main = document.getElementById('m')!
    const writes: string[] = []
    new MutationObserver((list) => { for (const m of list) writes.push(`${(m.target as Element).id}.${m.attributeName}`) })
      .observe(main, { attributes: true })
    document.getElementById('a2')!.focus()
    expect(marked(FOCUS_WITHIN_ATTRIBUTE)).toEqual(['HTML', 'BODY', 'm', 'a2'])
    return Promise.resolve().then(() => expect(writes).toEqual([]))
  })

  it('recomputes tokens when the watch list changes and clears everything on stop', () => {
    document.body.innerHTML = '<nav id="n" data-slot="nav.top"><button id="b1"></button></nav>'
    stop = startFocusMirror()
    document.getElementById('b1')!.focus()
    expect(marked(HAS_FOCUS_ATTRIBUTE)).toEqual([])
    setFocusWatches(watches)
    expect(marked(HAS_FOCUS_ATTRIBUTE)).toEqual(['n', 'b1'])
    stop()
    stop = undefined
    expect(marked(FOCUS_ATTRIBUTE)).toEqual([])
    expect(marked(FOCUS_WITHIN_ATTRIBUTE)).toEqual([])
    expect(marked(HAS_FOCUS_ATTRIBUTE)).toEqual([])
  })

  it('clears the path after a blur to nothing', async () => {
    document.body.innerHTML = '<button id="b1"></button>'
    stop = startFocusMirror()
    const button = document.getElementById('b1')!
    button.focus()
    button.blur()
    await Promise.resolve()
    expect(marked(FOCUS_ATTRIBUTE)).toEqual([])
    expect(marked(FOCUS_WITHIN_ATTRIBUTE)).toEqual([])
  })
})
