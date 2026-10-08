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
    // `listEpisodes` is the list's own numbers (downloaded ones offline), shared with the flip rule.
    expect(detail).toContain('const listEpisodes = (m: Media) => ($offlineMode ? downloadedEpisodes(m) : animeEpisodeNumbers(m))')
    // From what the page shows, so the header keeps its shape from the loading page to the loaded one.
    expect(detail).toContain('playableThrough(listEpisodes(shown), airedCount(shown), $offlineMode) > 0')
    expect(detail.match(/\{#if !headerCtaHidden\}/g)?.length).toBe(2)
    expect(detail.match(/onpointerenter=\{warmPlay\}/g)).toHaveLength(4)
  })
  // "Continue: Episode 1071", not the number badges' "A1071" form, like the other new pieces.
  it('prints the plain episode number on the card', () => {
    expect(list).toContain("const printedNumber = (episode: number) => episodeNoText(episode, meta[episode]?.abs, $absoluteEpisodeNumbers)")
    expect(list).toContain("{watchedThrough > 0 || started > 0 ? 'Continue' : 'Play'}: Episode {printedNumber(target)}</span>")
    expect(list).not.toContain('Episode {numberLabel(target)}')
  })
  it('resumes offline from the episode the header Play button opens', () => {
    expect(list).toContain('? offlineResumeEpisode(offlineEps, watchedThrough)')
    expect(detail).toContain('return offlineResumeEpisode(downloadedEpisodes(m), watchedThrough)')
    expect(detail).not.toContain('$localHistory[m.id]?.progress ?? 0')
  })
  it('keeps the phone Play button while the episodes, and so the card, are off the page', () => {
    expect(detail).toMatch(/import \{[^}]*\bepisodesOnPage\b[^}]*\} from '\$lib\/detail\/sections'/)
    expect(detail).toContain('&& episodesOnPage(mobileTabs, shownTab(mobileTabs), !episodeTabbed)')
  })
})
