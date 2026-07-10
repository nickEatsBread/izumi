import { describe, it, expect } from 'vitest'
import { LoadDoc } from './seanime-shim'

const HTML = `
<div id="root">
  <ul class="eps">
    <li class="ep" data-num="1"><a href="/e/1" title="Ep 1">First</a></li>
    <li class="ep" data-num="2"><a href="/e/2" title="Ep 2">Second</a></li>
    <li class="ep" data-num="3"><a href="/e/3" title="Ep 3">Third</a></li>
  </ul>
</div>`

describe('LoadDoc / DocSelection', () => {
  it('find + attr + text on the first match', () => {
    const $ = LoadDoc(HTML)
    const a = $.find('.ep a')
    expect(a.length).toBe(3)
    expect(a.attr('href')).toBe('/e/1')
    expect(a.first().text()).toBe('First')
  })

  it('each yields index + a WRAPPED element you can .attr() on', () => {
    const $ = LoadDoc(HTML)
    const hrefs: string[] = []
    const idxs: number[] = []
    $.find('.ep a').each((i, el) => { idxs.push(i); hrefs.push(el.attr('href') ?? '') })
    expect(idxs).toEqual([0, 1, 2])
    expect(hrefs).toEqual(['/e/1', '/e/2', '/e/3'])
  })

  it('map returns a plain array of callback results', () => {
    const $ = LoadDoc(HTML)
    const titles = $.find('.ep a').map((_, el) => el.attr('title')) as string[]
    expect(titles).toEqual(['Ep 1', 'Ep 2', 'Ep 3'])
  })

  it('eq + nested find + children + data attr', () => {
    const $ = LoadDoc(HTML)
    expect($.find('.ep').eq(1).find('a').attr('href')).toBe('/e/2')
    expect($.find('.eps').children().length).toBe(3)
    expect($.find('.ep').eq(2).attr('data-num')).toBe('3')
  })

  it('empty selection is safe', () => {
    const $ = LoadDoc(HTML)
    const none = $.find('.nope')
    expect(none.length).toBe(0)
    expect(none.text()).toBe('')
    expect(none.attr('href')).toBeUndefined()
  })
})
