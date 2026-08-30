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
    expect(play).toContain('prefetchAddonStreams(base, ids, streamType(media))')
    expect(play).toContain('void prepareEmbeddedPlayer()')
  })

  it('is wired to episode rows and both primary play buttons', () => {
    expect(list).toContain('onpointerenter={() => intent(ep)}')
    expect(list).toContain('onintent={intent}')
    expect(detail.match(/onpointerenter=\{\(\) => prefetchEpisodeSources\(m, ctaEp\(m\)\)\}/g)).toHaveLength(2)
  })
})
