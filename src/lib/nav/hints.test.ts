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
    const button = el('<div data-nav-trap><button data-focusable><svg></svg></button></div>', 'button')
    expect(labels(hintsFor(button, { home: true, pageTabs: false }))).toEqual(['a:Select', 'b:Close'])
  })
  it('treats an open dialog as the context even when focus stayed on the page behind it', () => {
    const episode = el('<div data-part="episode" data-focusable></div><div data-nav-trap></div>', '[data-part="episode"]')
    expect(labels(hintsFor(episode, { home: false, pageTabs: false, dialog: true }))).toEqual(['a:Select', 'b:Close'])
  })
  it('follows the Back model’s own hint when it publishes one', () => {
    const button = el('<button data-focusable><svg></svg></button>', 'button')
    const b = (back: string) => hintsFor(button, { home: false, pageTabs: false, back }).find((hint) => hint.button === 'b')?.label
    expect(b('close')).toBe('Close')
    expect(b('parent')).toBe('Back')
    expect(b('rail')).toBe('Categories')
    expect(b('leave')).toBe('Back')
    expect(b('exit')).toBe('Exit')
    expect(b('sideways')).toBe('Back')
  })
  it('names a plain control by its own short label', () => {
    const watch = el('<button data-focusable> <svg></svg> Watch   Now </button>', 'button')
    expect(hintsFor(watch, { home: false, pageTabs: false })[0]).toEqual({ button: 'a', label: 'Watch Now' })
    const share = el('<button data-focusable aria-label="Share"><svg></svg></button>', 'button')
    expect(hintsFor(share, { home: false, pageTabs: false })[0]).toEqual({ button: 'a', label: 'Share' })
    const long = el('<button data-focusable>Continue from where you left off last night</button>', 'button')
    expect(hintsFor(long, { home: false, pageTabs: false })[0]).toEqual({ button: 'a', label: 'Select' })
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
