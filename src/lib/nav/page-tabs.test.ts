// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { findPageTabs, stepPageTabs } from './page-tabs'

afterEach(() => { document.body.innerHTML = '' })

function strip(html: string) {
  document.body.innerHTML = html
  const clicks: string[] = []
  for (const item of document.querySelectorAll<HTMLElement>('button, a')) item.addEventListener('click', (event) => { event.preventDefault(); clicks.push(item.id) })
  return clicks
}

describe('page tabs', () => {
  it('clicks the neighbour of the active tab and stops at the ends', () => {
    const clicks = strip('<div data-page-tabs><button id="a">A</button><button id="b" data-active>B</button><button id="c">C</button></div>')
    expect(stepPageTabs(1)).toBe(true)
    expect(stepPageTabs(-1)).toBe(true)
    expect(clicks).toEqual(['c', 'a'])
    document.getElementById('b')!.removeAttribute('data-active')
    document.getElementById('c')!.setAttribute('aria-selected', 'true')
    expect(stepPageTabs(1)).toBe(false)
  })
  it('reads aria-current links and skips disabled and opted-out items', () => {
    const clicks = strip('<nav data-page-tabs><a id="lists" href="#" aria-current="page">Lists</a><button id="off" disabled>Off</button><a id="discover" href="#">Discover</a><a id="manage" href="#" data-page-tabs-skip>Manage</a></nav>')
    expect(stepPageTabs(1)).toBe(true)
    expect(clicks).toEqual(['discover'])
    document.getElementById('lists')!.removeAttribute('aria-current')
    document.getElementById('discover')!.setAttribute('aria-current', 'page')
    expect(stepPageTabs(1)).toBe(false)
  })
  it('starts from an end when nothing is active', () => {
    const clicks = strip('<div data-page-tabs><button id="a">A</button><button id="b">B</button></div>')
    stepPageTabs(-1)
    expect(clicks).toEqual(['b'])
  })
  it('uses the open dialog’s strip, else the first strip outside dialogs', () => {
    strip('<div data-page-tabs id="page"><button data-active>P</button></div><div data-nav-trap><div data-page-tabs id="dialog"><button data-active>D</button></div></div>')
    expect(findPageTabs()?.id).toBe('dialog')
    document.querySelector('[data-nav-trap]')!.remove()
    expect(findPageTabs()?.id).toBe('page')
    document.body.innerHTML = ''
    expect(findPageTabs()).toBeNull()
    expect(stepPageTabs(1)).toBe(false)
  })
})
