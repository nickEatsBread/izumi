import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  autoSelectCountdown,
  seadexAnnotations,
  androidAutoPip,
  subtitleStyleEnabled,
  secondarySubtitles,
  subtitleStripSdh,
  audioProcessing,
  windowsVsr,
  subtitleProviders,
  subDlApiKey,
  jimakuApiKey,
  enabledSubtitleProviders,
} from './ui'

describe('source autoplay defaults', () => {
  it('plays the best source immediately instead of starting a countdown', () => {
    expect(get(autoSelectCountdown)).toBe(false)
  })
})

describe('source picker defaults', () => {
  it('marks curated best releases out of the box', () => {
    // It adds no source and sends no identity — it annotates rows the picker already found, for one
    // heavily cached request per title. Defaulting it off would hide the best evidence we have.
    expect(get(seadexAnnotations)).toBe(true)
  })
})

describe('android playback defaults', () => {
  it('shrinks into the miniplayer when leaving the app, like every other mobile video app', () => {
    expect(get(androidAutoPip)).toBe(true)
  })
})

describe('subtitle appearance defaults', () => {
  it('leaves embedded subtitle styling untouched', () => {
    expect(get(subtitleStyleEnabled)).toBe(false)
  })
  it('keeps language-learning and cleanup filters opt-in', () => {
    expect(get(secondarySubtitles)).toBe(false)
    expect(get(subtitleStripSdh)).toBe(false)
  })
})

describe('player enhancement defaults', () => {
  it('does not alter audio or enable vendor-specific upscaling', () => {
    expect(get(audioProcessing)).toBe('off')
    expect(get(windowsVsr)).toBe('off')
  })
})

describe('enabledSubtitleProviders', () => {
  beforeEach(() => { subtitleProviders.set(['opensubtitles']); subDlApiKey.set(''); jimakuApiKey.set('') })

  it('includes OpenSubtitles whenever toggled on — search is keyless', () => {
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles'])
  })
  it('excludes SubDL until an api key is set (SubDL needs a key even to search)', () => {
    subtitleProviders.set(['opensubtitles', 'subdl'])
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles'])
    subDlApiKey.set('KEY123')
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles', 'subdl'])
  })
  it('excludes Jimaku until an api key is set (every endpoint is authenticated)', () => {
    subtitleProviders.set(['opensubtitles', 'jimaku'])
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles'])
    jimakuApiKey.set('JKEY')
    expect(get(enabledSubtitleProviders)).toEqual(['opensubtitles', 'jimaku'])
  })
  it('excludes a provider that is toggled off', () => {
    subtitleProviders.set([])
    subDlApiKey.set('KEY123')
    expect(get(enabledSubtitleProviders)).toEqual([])
  })
})
