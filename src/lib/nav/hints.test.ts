// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { hintsFor } from './hints'

afterEach(() => { document.body.innerHTML = '' })
const el = (html: string, selector: string) => { document.body.innerHTML = html; return document.querySelector(selector) }
const labels = (hints: ReturnType<typeof hintsFor>) => hints.map((hint) => `${hint.button}:${hint.label}`)

describe('hintsFor', () => {
  it('resumes and removes a Continue card, and exits from Home', () => {
    const card = el('<div data-part="card" data-family="continue" data-focusable></div>', '[data-part="card"]')
    expect(labels(hintsFor(card, { home: true, pageTabs: false }))).toEqual(['a:Resume', 'x:Remove', 'b:Exit', 'start:Menu'])
  })
  it('opens a poster card and offers page tabs off Home', () => {
    const link = el('<div data-part="card" data-family="poster"><a href="#" data-focusable>x</a></div>', 'a')
    expect(labels(hintsFor(link, { home: false, pageTabs: true }))).toEqual(['a:Open', 'b:Back', 'l2r2:Tabs', 'start:Menu'])
  })
  it('plays an episode', () => {
    const episode = el('<div data-part="episode" data-focusable></div>', '[data-part="episode"]')
    expect(hintsFor(episode, { home: false, pageTabs: false })[0]).toEqual({ button: 'a', label: 'Play' })
  })
  it('closes inside a dialog and drops the menu prompt', () => {
    const button = el('<div data-nav-trap><button data-focusable>Ok</button></div>', 'button')
    expect(labels(hintsFor(button, { home: true, pageTabs: false }))).toEqual(['a:Select', 'b:Close'])
  })
  it('lets an element name its own actions', () => {
    const button = el('<button data-focusable data-hint-a="Install" data-hint-x="Details">x</button>', 'button')
    expect(labels(hintsFor(button, { home: false, pageTabs: false }))).toEqual(['a:Install', 'x:Details', 'b:Back', 'start:Menu'])
  })
  it('shows only Back and Menu when nothing holds focus', () => {
    expect(labels(hintsFor(document.body, { home: false, pageTabs: false }))).toEqual(['b:Back', 'start:Menu'])
    expect(labels(hintsFor(null, { home: false, pageTabs: false }))).toEqual(['b:Back', 'start:Menu'])
  })
})
