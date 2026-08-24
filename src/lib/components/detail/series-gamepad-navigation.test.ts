import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('./EpisodeCard.svelte', import.meta.url)), 'utf8')

describe('series page gamepad fast lane', () => {
  it('routes Down from the primary action straight to the relevant episode', () => {
    expect(detail).toContain('data-nav-id="series-primary-action"')
    expect(detail).toContain('data-nav-id="series-primary-action" data-nav-scroll-top')
    expect(detail).toContain("data-nav-down={$gameMode ? 'series-quick-episode' : undefined}")
    expect(list).toContain("data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}")
  })

  it('chooses the next watched-progress episode and returns Up directly to Play', () => {
    expect(list).toContain('Math.min(watchedThrough + 1, aired || 1)')
    expect(list).toContain("data-nav-up={ep === quickEpisode ? 'series-primary-action' : undefined}")
    expect(card).toContain('data-nav-up={navUp}')
  })

  it('keeps the fast target actionable while episode metadata is loading', () => {
    const skeleton = list.slice(list.indexOf('{#if metaLoading}'), list.indexOf('{:else if $episodeLayout'))
    expect(skeleton).toContain("data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}")
    expect(skeleton).toContain('onclick={() => tap(ep)}')
  })

  it('does not turn genre metadata into controller stops', () => {
    expect(detail).toContain("data-focusable={$gameMode ? undefined : ''}")
    expect(detail).toContain('tabindex={$gameMode ? -1 : undefined}')
  })
})
