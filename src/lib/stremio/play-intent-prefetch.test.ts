import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const play = readFileSync(fileURLToPath(new URL('./play.ts', import.meta.url)), 'utf8')
const list = readFileSync(fileURLToPath(new URL('../components/detail/EpisodeList.svelte', import.meta.url)), 'utf8')
const detail = readFileSync(fileURLToPath(new URL('../components/detail/AnimeDetail.svelte', import.meta.url)), 'utf8')

describe('episode play-intent prefetch', () => {
  it('warms exact addon streams, mappings, and the Android core behind a short intent delay', () => {
    expect(play).toContain('export function prefetchEpisodeSources')
    expect(play).toContain('mediaSeasonMap(media)')
    expect(play).toContain('mediaExtensionIds(media, episode)')
    expect(play).toContain('prefetchAddonStreams(base, ids, streamResourceType(media))')
    expect(play).toContain('void prepareEmbeddedPlayer()')
  })

  it('is wired to episode rows and both primary play buttons', () => {
    expect(list).toContain('onpointerenter={() => intent(ep)}')
    expect(list).toContain('onintent={intent}')
    // The phone header's Play (stacked page and overlay body share one) and the two desktop ones.
    expect(detail.match(/onpointerenter=\{warmPlay\}/g)).toHaveLength(3)
    // The page renders before its record lands; the full record is what gets warmed, at once or on arrival.
    expect(detail).toContain('if (media) prefetchEpisodeSources(media, ctaEp(media))')
    expect(detail).toContain("untrack(() => prefetchEpisodeSources(target, ctaEp(target)))")
  })
})
