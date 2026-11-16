import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { bestAnilistMatch } from './anilist-match'

const media = (id: number, english: string, year?: number) =>
  ({ id, title: { english, romaji: english, userPreferred: english }, startDate: { year } }) as unknown as Media

describe('finding a source title on AniList', () => {
  it('takes the candidate whose title names it', () => {
    expect(bestAnilistMatch(media(-1, 'Moonlit Harbor'), [media(1, 'Sunlit Fields'), media(2, 'Moonlit Harbor')])?.id).toBe(2)
  })

  it('lets the closer start year break a tie between remakes', () => {
    const found = bestAnilistMatch(media(-1, 'Moonlit Harbor', 2024), [media(1, 'Moonlit Harbor', 2009), media(2, 'Moonlit Harbor', 2024)])
    expect(found?.id).toBe(2)
  })

  it('finds nothing rather than a different show', () => {
    expect(bestAnilistMatch(media(-1, 'Moonlit Harbor'), [media(1, 'Sunlit Fields'), media(2, 'Paper Kites')])).toBeNull()
  })
})
