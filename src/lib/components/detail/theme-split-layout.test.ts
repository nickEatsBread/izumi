import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('./EpisodeCard.svelte', import.meta.url)), 'utf8')

describe('themed series page composition', () => {
  it('reads placement from the presentation contract instead of a one-off flag', () => {
    expect(detail).toContain('resolveDetail($themePresentation)')
    expect(detail).toContain('episodesOnSide($themePresentation, !$isMobile)')
    expect(detail).toContain('episodesBelow($themePresentation, !$isMobile)')
    expect(detail).toContain('overlayDetail')
    expect(detail).toContain('sideEpisodes')
    expect(detail).toContain('minmax(22rem,40%)')
    expect(detail).toContain('data-theme-surface="detail-overlay"')
  })
  it('keeps the play-to-episode gamepad lane when the rail moves', () => {
    expect(detail).toContain('data-nav-id="series-primary-action"')
    expect(detail).toContain("data-nav-down={controllerUi ? 'series-quick-episode' : undefined}")
    expect(list).toContain("data-nav-id={ep === quickEpisode ? 'series-quick-episode' : undefined}")
  })
  it('renders episode templates inside the host-owned play control', () => {
    expect(list).toContain('themeCard={episodeCard}')
    expect(list).toContain('episodeListLayout')
    expect(list).toContain("arrangement === 'list'")
    expect(card).toContain('{#if themeCard}')
    expect(card).toContain('<ThemeNode node={themeCard}')
    expect(card).toContain('hoverScale')
    expect(card).toContain('labels.concealSecondary')
    expect(card).not.toContain('description: labels.concealSecondary ? undefined : labels.secondary')
    expect(card).not.toContain('actions={{ play:')
  })
  it('lets a series-facts template replace the default dotted metadata line', () => {
    expect(detail).toContain('detailTheme.facts')
    expect(detail).toContain('<ThemeNode node={detailTheme.facts}')
  })
  it('collapses a right-hand rail on the phone layout', () => {
    expect(detail).toContain('{#if belowEpisodes}')
    expect(detail).toContain('mobileTabs')
  })
})
