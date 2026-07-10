import { describe, it, expect } from 'vitest'
import { LoadDoc, CryptoJS } from './seanime-shim'
import { Buffer as BufferShim } from './seanime-shim'

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

describe('Buffer polyfill', () => {
  it('base64 -> utf8 round-trips', () => {
    const b64 = BufferShim.from('hello world', 'utf8').toString('base64')
    expect(b64).toBe('aGVsbG8gd29ybGQ=')
    expect(BufferShim.from(b64, 'base64').toString('utf8')).toBe('hello world')
  })
  it('decodes an iframe-style base64 blob to utf8', () => {
    expect(BufferShim.from('PGlmcmFtZT4=', 'base64').toString('utf8')).toBe('<iframe>')
  })
  it('hex round-trips', () => {
    expect(BufferShim.from('ff00aa', 'hex').toString('hex')).toBe('ff00aa')
  })
  it('defaults to utf8', () => {
    expect(BufferShim.from('abc').toString()).toBe('abc')
  })
})

describe('CryptoJS', () => {
  it('exposes crypto-js (MD5 smoke test)', () => {
    expect(CryptoJS.MD5('hello').toString()).toBe('5d41402abc4b2a76b9719d911017c592')
  })
})
