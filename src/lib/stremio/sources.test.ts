import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { addonUrls, disabledSources, enabledAddonUrls } from './sources'

describe('enabledAddonUrls', () => {
  it('filters out disabled sources, keeps the rest', () => {
    addonUrls.set(['https://a', 'https://b', 'https://c'])
    disabledSources.set(['https://b'])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://c'])
    disabledSources.set([])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://b', 'https://c'])
    addonUrls.set([]); disabledSources.set([])
  })
})
