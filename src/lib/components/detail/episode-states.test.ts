import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_HOOKS } from '$lib/themes/hooks'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const list = read('./EpisodeList.svelte')
const card = read('./EpisodeCard.svelte')
const docs = read('../../../../docs/THEMES.md')

describe('episode states for theme stylesheets', () => {
  it('marks every episode element with its state, the Play target and filler', () => {
    // The prop is still named `state` (EpisodeList passes state={stateOf(ep)}); the card aliases
    // it to `tileState` internally because a binding literally named `state` in this file would
    // make every `$state(...)` rune call below (imgReady) ambiguous with store auto-subscription.
    expect(card).toContain('data-state={tileState}')
    expect(card).toContain('data-next={cta || undefined}')
    expect(card).toContain('data-filler={filler || undefined}')
    expect(list).toContain('data-state={tile.kind}')
    expect(list).toContain('data-state={stateOf(ep)}')
    expect(list.match(/data-next=\{ep === ctaEpisode && ep <= aired \|\| undefined\}/g)?.length).toBe(2)
    expect(list.match(/\sstate=\{stateOf\(ep\)\}/g)?.length).toBe(2)
    expect(list.match(/cta=\{ep === ctaEpisode && ep <= aired\}/g)?.length).toBe(2)
  })
  it("says when an unaired episode arrives, to templates and in izumi's own tiles", () => {
    // The schedule's airing time (or the next-airing record's), else the episode metadata's air day.
    expect(card).toContain('const arrival = $derived(released ? undefined : arrivalDayText(')
    expect(card).toContain('media.airingSchedule?.nodes?.find((node) => node.episode === ep)?.airingAt ?? (isNext ? next?.airingAt : undefined), meta?.airDate))')
    expect(card).toContain('upcoming: upcomingText(released, arrival),')
    // izumi's own tiles keep the next episode's countdown and "Not aired" when no day is known.
    expect(card.match(/arrival \? `Coming \$\{arrival\}` : 'Not aired'/g)?.length).toBe(2)
    expect(list).toContain("{arrival ? `Coming ${arrival}` : 'Not aired'}")
    expect(list).toContain('arrivalDayText(media.airingSchedule?.nodes?.find((node) => node.episode === ep)?.airingAt, meta[ep]?.airDate)')
  })
  it('takes the Play target from the page CTA rule and the playable count from the shared helper', () => {
    expect(list).toContain('const ctaEpisode = $derived(offline')
    expect(list).toContain(': animeResumeEpisode(media, resumeThrough))')
    expect(list).toContain('const resumeThrough = $derived(seriesResumeProgress(media, $localHistory, $sessionProgress, $manualProgressOverrides))')
    expect(list).toContain('const aired = $derived(playableThrough(allEpisodes, airedCount(media), offline))')
  })
  it('gives `resume` only to the episode `data-next` marks, in every layout', () => {
    // Cards and rows (stateOf) and the number tiles take the resume point from the Play episode, so a
    // tracker count behind this device's history never rings a second episode.
    expect(list.match(/resumeEpisode: ctaEpisode,/g)?.length).toBe(2)
    expect(list).not.toContain('watchedThrough + 1')
  })
  it('binds the episode template fields', () => {
    expect(card).toContain('episodeNo: episodeNoText(ep, meta?.abs, $absoluteEpisodeNumbers)')
    expect(card).toContain("watched: trackedDone ? 'Watched' : undefined")
    expect(card).toContain("filler: filler ? 'Filler' : undefined")
    expect(card).toContain('rating: episodeRatingText(meta?.rating, released)')
  })
  it('documents the states', () => {
    expect(THEME_HOOKS.episodes?.find((hook) => hook.name === 'episode')?.states).toEqual(['data-variant', 'data-state', 'data-next', 'data-filler'])
    expect(docs).toContain('| `data-state` | `episode` |')
    expect(docs).toContain('| `data-next` | `episode` |')
    expect(docs).toContain('| `data-filler` | `episode` |')
  })
})
