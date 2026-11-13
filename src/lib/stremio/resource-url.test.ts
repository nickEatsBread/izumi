import { describe, expect, it } from 'vitest'
import { addonResourceUrl } from './resource-url'

describe('addonResourceUrl', () => {
  it('keeps a configuration query after the resource path', () => {
    expect(addonResourceUrl('https://h.test/addon/manifest.json?token=x', '/stream/series/tt0000001%3A1%3A2.json'))
      .toBe('https://h.test/addon/stream/series/tt0000001%3A1%3A2.json?token=x')
    expect(addonResourceUrl('https://h.test/addon?token=x', '/meta/movie/tt0000001.json'))
      .toBe('https://h.test/addon/meta/movie/tt0000001.json?token=x')
  })

  it('appends to a plain base unchanged', () => {
    expect(addonResourceUrl('https://h.test', '/catalog/movie/top/search=a%20b&skip=10.json'))
      .toBe('https://h.test/catalog/movie/top/search=a%20b&skip=10.json')
    expect(addonResourceUrl('http://h.test/cfg/manifest.json', '/subtitles/movie/tt0000001/filename=x.mkv.json'))
      .toBe('https://h.test/cfg/subtitles/movie/tt0000001/filename=x.mkv.json')
  })
})
