import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { singleSeasonLabel } from './season-label'

const edge = (relationType: string, format: string, type = 'ANIME') => ({ relationType, node: { id: Math.random(), format, type, title: {} } as Media })
const title = (format: string, edges: ReturnType<typeof edge>[] = []) => ({ format, relations: { edges } }) as Media

describe('the single season an episode list shows', () => {
  it('names a standalone season "Season 1"', () => {
    expect(singleSeasonLabel(title('TV'))).toBe('Season 1')
    expect(singleSeasonLabel(title('ONA', [edge('ADAPTATION', 'MANGA', 'MANGA'), edge('SIDE_STORY', 'OVA')]))).toBe('Season 1')
    expect(singleSeasonLabel(title('TV_SHORT'))).toBe('Season 1')
  })

  it('leaves a title with a prequel or sequel to the season picker, a film between seasons included', () => {
    expect(singleSeasonLabel(title('TV', [edge('SEQUEL', 'TV')]))).toBeUndefined()
    expect(singleSeasonLabel(title('TV', [edge('PREQUEL', 'MOVIE')]))).toBeUndefined()
    // A manga "sequel" is not part of the anime chain.
    expect(singleSeasonLabel(title('TV', [edge('SEQUEL', 'MANGA', 'MANGA')]))).toBe('Season 1')
  })

  it('follows the walked chain when the page has it', () => {
    // A season whose only sequel is a film is still the one season of its chain.
    expect(singleSeasonLabel(title('TV', [edge('SEQUEL', 'MOVIE')]), [{ format: 'TV' }, { format: 'MOVIE' }])).toBe('Season 1')
    expect(singleSeasonLabel(title('TV', [edge('SEQUEL', 'MOVIE')]), [{ format: 'TV' }, { format: 'MOVIE' }, { format: 'ONA' }])).toBeUndefined()
  })

  it('files OVAs and specials under Specials, and names no season for a film or an unknown record', () => {
    expect(singleSeasonLabel(title('OVA', [edge('PARENT', 'TV')]))).toBe('Specials')
    expect(singleSeasonLabel(title('SPECIAL'))).toBe('Specials')
    expect(singleSeasonLabel(title('MOVIE'))).toBeUndefined()
    expect(singleSeasonLabel(title('MUSIC'))).toBeUndefined()
    expect(singleSeasonLabel({ format: undefined } as Media)).toBeUndefined()
    // The card the user tapped carries no relations: nothing yet.
    expect(singleSeasonLabel({ format: 'TV' } as Media)).toBeUndefined()
  })
})
