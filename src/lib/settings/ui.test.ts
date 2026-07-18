import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { subtitleProviders, subDlApiKey, enabledSubtitleProviders } from './ui'

describe('enabledSubtitleProviders', () => {
  beforeEach(() => { subtitleProviders.set(['opensubtitles']); subDlApiKey.set('') })

  it('includes OpenSubtitles whenever toggled on — search is keyless', () => {
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles'])
  })
  it('excludes SubDL until an api key is set (SubDL needs a key even to search)', () => {
    subtitleProviders.set(['opensubtitles', 'subdl'])
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles'])
    subDlApiKey.set('KEY123')
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles', 'subdl'])
  })
  it('excludes a provider that is toggled off', () => {
    subtitleProviders.set([])
    subDlApiKey.set('KEY123')
    expect(get(enabledSubtitleProviders)).toEqual([])
  })
})
