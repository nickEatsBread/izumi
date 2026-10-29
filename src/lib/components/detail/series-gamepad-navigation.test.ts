import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('./EpisodeCard.svelte', import.meta.url)), 'utf8')

describe('series page gamepad fast lane', () => {
  it('brings the whole header back into view when Up reaches any of its buttons, not only Play', () => {
    // From the second episode Up lands on More options or Watchlist: the page stayed scrolled with the
    // title cut off, while Up from the first episode (to Play) went back to the top.
    const source = readFileSync(fileURLToPath(new URL('../catalog/CatalogMediaDetail.svelte', import.meta.url)), 'utf8')
    expect(source).toContain('data-action="more" data-focusable data-nav-scroll-top')
    expect(source).toContain("data-action=\"watchlist\" data-state={watchlisted ? 'saved' : undefined} data-focusable data-nav-scroll-top")
    expect(detail.match(/data-action="save" data-state=\{watchlisted \? 'saved' : undefined\} data-focusable data-nav-scroll-top/g)).toHaveLength(3)
    expect(detail.match(/data-part="detail.action" data-action="more" data-focusable data-nav-scroll-top/g)).toHaveLength(3)
  })

  it('routes Down from the primary action straight to the relevant episode', () => {
    expect(detail).toContain('data-nav-id="series-primary-action"')
    expect(detail).toContain('data-nav-id="series-primary-action" data-nav-scroll-top')
    expect(detail).toContain("data-nav-down={controllerUi ? 'series-quick-episode' : undefined}")
    expect(list).toContain("data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}")
  })

  it('chooses the next watched-progress episode and returns Up directly to Play', () => {
    // The episode Play opens: the count Continue Watching resumes by (resume.ts).
    expect(list).toContain('Math.min(resumeThrough + 1, aired || 1)')
    expect(list).toContain("data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}")
    expect(card).toContain('data-nav-up={navUp}')
  })

  it('keeps the fast target actionable while episode metadata is loading', () => {
    const skeleton = list.slice(list.indexOf('{#if metaLoading}'), list.indexOf('{:else if $episodeLayout'))
    expect(skeleton).toContain("data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}")
    expect(skeleton).toContain('onclick={(event) => tap(ep, event)}')
  })

  it('does not turn genre metadata into controller stops', () => {
    expect(detail).toContain("data-focusable={controllerUi ? undefined : ''}")
    expect(detail).toContain('tabindex={controllerUi ? -1 : undefined}')
  })
})
