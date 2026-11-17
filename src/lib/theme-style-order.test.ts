// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stylesheetAfter } from './theme'

describe('stylesheetAfter', () => {
  it('moves the theme stylesheet only for a stylesheet after it, never for a chunk preload', () => {
    document.head.innerHTML = '<style id="izumi-theme-css"></style><link rel="modulepreload" href="/a.js"><script></script>'
    const theme = document.getElementById('izumi-theme-css')!
    expect(stylesheetAfter(theme)).toBe(false)
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/route.css">')
    expect(stylesheetAfter(theme)).toBe(true)
    document.head.innerHTML = '<style id="izumi-theme-css"></style><style>.route{}</style>'
    expect(stylesheetAfter(document.getElementById('izumi-theme-css')!)).toBe(true)
  })
})
