import { describe, expect, it } from 'vitest'
import { alignEpisodeNumbers, alignProviderEpisodes, type EpisodeNumbers, type ProviderEpisode } from './episode-alignment'

type Row = [season: number | undefined, episode: number | undefined, abs?: number]
const rows = (list: Record<number, Row>): Record<number, EpisodeNumbers> =>
  Object.fromEntries(Object.entries(list).map(([n, [season, episode, abs]]) => [n, { season, episode, abs }]))

describe('alignEpisodeNumbers', () => {
  it('unfolds a premiere the mapping service paired with the next episode', () => {
    // A new second season whose AniList air dates run a week ahead of the episode database:
    // episode 1 found no date match, episode 2 matched S2E1, and every later episode inherited
    // that one-episode lag.
    const aligned = alignEpisodeNumbers(rows({
      1: [2, 1, 13], 2: [2, 1, 13], 3: [2, 2, 14], 4: [2, 3, 15], 5: [2, 4, 16],
    }))
    expect(aligned).toEqual(rows({
      1: [2, 1, 13], 2: [2, 2, 14], 3: [2, 3, 15], 4: [2, 4, 16], 5: [2, 5, 17],
    }))
  })

  it('stops the premiere repair where the mapping already caught up', () => {
    const aligned = alignEpisodeNumbers(rows({ 1: [1, 1, 1], 2: [1, 1, 1], 3: [1, 3, 3], 4: [1, 4, 4] }))
    expect(aligned).toEqual(rows({ 1: [1, 1, 1], 2: [1, 2, 2], 3: [1, 3, 3], 4: [1, 4, 4] }))
  })

  it('repairs a premiere pair when the mapping has no absolute numbers yet', () => {
    const aligned = alignEpisodeNumbers(rows({ 1: [1, 1], 2: [1, 1], 3: [1, 2] }))
    expect(aligned).toEqual(rows({ 1: [1, 1], 2: [1, 2], 3: [1, 3] }))
  })

  it('moves the absolute numbers too when only the second row of the pair carries one', () => {
    const aligned = alignEpisodeNumbers(rows({ 1: [2, 1], 2: [2, 1, 13], 3: [2, 2, 14], 4: [2, 3, 15] }))
    expect(aligned).toEqual(rows({ 1: [2, 1], 2: [2, 2, 14], 3: [2, 3, 15], 4: [2, 4, 16] }))
  })

  it('anchors the premiere on episode 1 when the mapping also lists an episode 0', () => {
    const aligned = alignEpisodeNumbers(rows({ 0: [0, 1], 1: [1, 1, 1], 2: [1, 1, 1], 3: [1, 2, 2] }))
    expect(aligned).toEqual(rows({ 0: [0, 1], 1: [1, 1, 1], 2: [1, 2, 2], 3: [1, 3, 3] }))
  })

  it('moves a single row that jumped ahead into the gap it left', () => {
    const aligned = alignEpisodeNumbers(rows({
      19: [2, 11, 19], 20: [2, 13, 21], 21: [2, 13, 21], 22: [2, 14, 22],
    }))
    expect(aligned).toEqual(rows({
      19: [2, 11, 19], 20: [2, 12, 20], 21: [2, 13, 21], 22: [2, 14, 22],
    }))
  })

  it('moves a single row that lagged behind into the gap after it', () => {
    const aligned = alignEpisodeNumbers(rows({
      144: [20, 144, 1367], 145: [20, 144, 1367], 146: [20, 146, 1369],
    }))
    expect(aligned[145]).toEqual({ season: 20, episode: 145, abs: 1368 })
  })

  it('repairs the misplaced first row of a season across the season boundary', () => {
    const aligned = alignEpisodeNumbers(rows({
      47: [3, 17, 47], 48: [4, 2, 49], 49: [4, 2, 49], 50: [4, 3, 50],
    }))
    expect(aligned[48]).toEqual({ season: 4, episode: 1, abs: 48 })
    expect(aligned[49]).toEqual({ season: 4, episode: 2, abs: 49 })
  })

  it('leaves consistent maps alone, including a split cour that continues its season', () => {
    const consistent = rows({ 1: [1, 13, 13], 2: [1, 14, 14], 3: [1, 15, 15] })
    expect(alignEpisodeNumbers(consistent)).toEqual(consistent)
  })

  it('does not invent numbers for rows the mapping cannot place', () => {
    const sparse = rows({ 1: [1, 1, 1], 2: [undefined, undefined], 3: [undefined, undefined], 4: [1, 4, 4] })
    expect(alignEpisodeNumbers(sparse)).toEqual(sparse)
  })

  it('leaves a run of three identical rows alone because no single gap explains it', () => {
    const run = rows({ 9: [1, 9, 9], 10: [1, 10, 10], 11: [1, 10, 10], 12: [1, 10, 10], 13: [1, 13, 13] })
    expect(alignEpisodeNumbers(run)).toEqual(run)
  })

  it('is stable when applied twice', () => {
    const once = alignEpisodeNumbers(rows({ 1: [2, 1, 13], 2: [2, 1, 13], 3: [2, 2, 14], 20: [2, 13, 21], 21: [2, 13, 21] }))
    expect(alignEpisodeNumbers(once)).toEqual(once)
  })

  it('does not mutate its input', () => {
    const input = rows({ 1: [2, 1, 13], 2: [2, 1, 13], 3: [2, 2, 14] })
    const copy = structuredClone(input)
    alignEpisodeNumbers(input)
    expect(input).toEqual(copy)
  })
})

describe('alignProviderEpisodes', () => {
  // Shape and values of the mapping service's response for a season whose dates ran ahead.
  const response: Record<string, ProviderEpisode & { anidbEid?: number; title?: { en: string } }> = {
    '1': { seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 13, tvdbId: 11877773, anidbEid: 316835, title: { en: 'The Floating Island' } },
    '2': { seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 13, tvdbId: 11877773, anidbEid: 316836, title: { en: 'Jean du Vix Knows His Stuff' } },
    '3': { seasonNumber: 2, episodeNumber: 2, absoluteEpisodeNumber: 14, tvdbId: 12009468, anidbEid: 316837 },
    '4': { seasonNumber: 2, episodeNumber: 3, absoluteEpisodeNumber: 15, tvdbId: 12009469, anidbEid: 316838 },
    S1: { title: { en: 'Recap' } },
  }

  it('rewrites the numbers and points the database episode id at the repaired episode', () => {
    const aligned = alignProviderEpisodes(response)
    expect(aligned['2']).toMatchObject({
      seasonNumber: 2, episodeNumber: 2, absoluteEpisodeNumber: 14, tvdbId: 12009468,
      anidbEid: 316836, title: { en: 'Jean du Vix Knows His Stuff' },
    })
    expect(aligned['3']).toMatchObject({ episodeNumber: 3, absoluteEpisodeNumber: 15, tvdbId: 12009469 })
    expect(aligned['1']).toBe(response['1'])
  })

  it('drops a database episode id the repaired episode has no row for', () => {
    expect(alignProviderEpisodes(response)['4']).toMatchObject({ episodeNumber: 4, absoluteEpisodeNumber: 16 })
    expect(alignProviderEpisodes(response)['4'].tvdbId).toBeUndefined()
  })

  it('skips empty rows instead of failing the whole show', () => {
    const withHole = { '1': { seasonNumber: 1, episodeNumber: 1 }, '2': null, '3': { seasonNumber: 1, episodeNumber: 3 } }
    expect(alignProviderEpisodes(withHole as never)).toEqual(withHole)
  })

  it('passes special keys and missing input through', () => {
    expect(alignProviderEpisodes(response).S1).toBe(response.S1)
    expect(alignProviderEpisodes(undefined)).toEqual({})
  })

  it('returns the same rows when nothing needs repair', () => {
    const fine = { '1': { seasonNumber: 1, episodeNumber: 1 }, '2': { seasonNumber: 1, episodeNumber: 2 } }
    const aligned = alignProviderEpisodes(fine)
    expect(aligned['1']).toBe(fine['1'])
    expect(aligned['2']).toBe(fine['2'])
  })
})
