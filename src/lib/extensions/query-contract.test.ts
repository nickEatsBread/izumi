import { describe, expect, it } from 'vitest'
import { torrentQueryIdFields } from './types'

describe('torrent extension query contract', () => {
  it('sends both supported SDK aliases for production ids', () => {
    expect(torrentQueryIdFields({
      anidbAid: 69,
      anidbEid: 440,
      tvdbId: 81797,
      tvdbEId: 361887,
      tmdbId: '37854',
      imdbId: 'tt0388629',
      season: 1,
      absoluteEpisodeNumber: 1,
    })).toMatchObject({
      anidbAid: 69,
      anidbEid: 440,
      tvdbId: 81797,
      tvdbAid: 81797,
      tvdbEid: 361887,
      tmdbId: '37854',
      mvdbAid: '37854',
      imdbAid: 'tt0388629',
      season: 1,
      absoluteEpisode: 1,
      absoluteEpisodeNumber: 1,
    })
  })
})
