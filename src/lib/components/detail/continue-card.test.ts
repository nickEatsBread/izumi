import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const list = read('./EpisodeList.svelte')
const detail = read('./AnimeDetail.svelte')

describe('continue card', () => {
  it('draws a Continue card when the theme asks and plays the Play target', () => {
    expect(list).toContain("const continueCard = $derived(resolveDetail($themePresentation).continue === 'card')")
    expect(list).toContain('{#if continueCard && aired > 0 && !selecting}')
    expect(list).toContain('data-part="episode.continue" data-filler={fillerSet.has(target) || undefined}')
    expect(list).toContain('data-part="episode.continue.label"')
    expect(list).toContain('data-part="episode.continue.title"')
    expect(list).toContain('else resumeEpisode(media, target, (s) => (playState = s))')
  })
  it('lets the card take the phone Play button once an episode can play', () => {
    expect(detail).toContain("detailTheme.continue === 'card'")
    expect(detail).toContain('playableThrough($offlineMode ? downloadedEpisodes(media) : animeEpisodeNumbers(media), airedCount(media), $offlineMode) > 0')
    expect(detail.match(/\{#if !headerCtaHidden\}/g)?.length).toBe(2)
    expect(detail.match(/onpointerenter=\{\(\) => prefetchEpisodeSources\(m, ctaEp\(m\)\)\}/g)).toHaveLength(4)
  })
})
