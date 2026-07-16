import { describe, expect, it } from 'vitest'
import { ANILIST_CACHE_KEYS } from './cache'
import { MEDIA_FIELDS } from './fragments'

describe('AniList Graphcache keys', () => {
  it.each(['MediaTitle', 'MediaCoverImage', 'FuzzyDate'])('%s is embedded on its parent', (type) => {
    expect(ANILIST_CACHE_KEYS[type]({ __typename: type })).toBeNull()
  })

  it('does not discard the identity of real AniList entities', () => {
    expect(ANILIST_CACHE_KEYS.Studio).toBeUndefined()
    expect(MEDIA_FIELDS.loc?.source.body.replace(/\s+/g, ' '))
      .toContain('studios(isMain: true) { nodes { id name } }')
  })
})
