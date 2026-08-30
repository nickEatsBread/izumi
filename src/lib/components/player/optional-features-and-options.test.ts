import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const controls = read('./Controls.svelte')
const android = read('./AndroidPlayer.svelte')
const overlay = read('./PlayerOverlay.svelte')
const episodes = read('../detail/EpisodeList.svelte')
const watchlist = read('../schedule/WatchlistView.svelte')

describe('optional watch tools', () => {
  it('hides episode-queue entry points until the feature is enabled', () => {
    expect(episodes).toContain('{#if $episodeQueueEnabled}<button data-focusable onclick={queueNextEpisode}')
    expect(episodes).toContain('onqueue={$episodeQueueEnabled ? queueEpisode : undefined}')
    expect(watchlist).toContain("$episodeQueueEnabled || list.id !== EPISODE_QUEUE_ID")
  })

  it('gates scene-bookmark entry points and shortcut handling on every player', () => {
    expect(controls).toContain('{#if $sceneBookmarksEnabled}<button data-focusable class={iconBtn}')
    expect(android).toContain('{#if $sceneBookmarksEnabled}')
    expect(overlay).toContain('if (!get(sceneBookmarksEnabled))')
  })
})

describe('desktop playback options menu', () => {
  it('uses the subtitle menu\'s compact summary-and-detail drill-down', () => {
    expect(controls).toContain('data-options-menu')
    expect(controls).toContain("type DesktopOptionsPage = 'root' | 'speed' | 'quality' | 'fit' | 'tools' | 'timing'")
    expect(controls).toContain("style=\"transform:translateX({optionsPage === 'root' ? '0' : '-50%'})\"")
    expect(controls).toContain('Subtitle appearance')
    expect(controls).toContain('Sleep, loops &amp; capture')
  })
})
