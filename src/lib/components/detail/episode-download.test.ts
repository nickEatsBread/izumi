import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { episodeDownloadAction, episodeDownloadLabel, episodeDownloadPercent, episodeDownloadState } from './episode-download'
import type { DownloadItem } from '$lib/downloads/state'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const item = (status: DownloadItem['status'], downloaded = 0, bytes = 0) => ({ status, downloaded, bytes })

describe('the per-episode download state', () => {
  it('names the four states, a paused download still in progress and a failed one back to none', () => {
    expect(episodeDownloadState(undefined)).toBe('none')
    expect(episodeDownloadState(item('error'))).toBe('none')
    expect(episodeDownloadState(item('queued'))).toBe('queued')
    expect(episodeDownloadState(item('downloading', 10, 100))).toBe('progress')
    expect(episodeDownloadState(item('paused', 10, 100))).toBe('progress')
    expect(episodeDownloadState(item('done', 100, 100))).toBe('done')
  })

  it('reports the share downloaded as a whole percent', () => {
    expect(episodeDownloadPercent(undefined)).toBe(0)
    expect(episodeDownloadPercent(item('downloading', 0, 0))).toBe(0)
    expect(episodeDownloadPercent(item('downloading', 421, 1000))).toBe(42)
    expect(episodeDownloadPercent(item('paused', 2000, 1000))).toBe(100)
    expect(episodeDownloadPercent(item('done'))).toBe(100)
    expect(episodeDownloadPercent(item('error', 500, 1000))).toBe(0)
  })

  it('queues an episode that is not downloading and manages one that is', () => {
    expect(episodeDownloadAction('none')).toBe('queue')
    for (const state of ['queued', 'progress', 'done'] as const) expect(episodeDownloadAction(state)).toBe('manage')
  })

  it('names the button for what it does, with the printed episode number', () => {
    expect(episodeDownloadLabel(undefined, '12')).toBe('Download episode 12')
    expect(episodeDownloadLabel(item('error'), '12')).toBe('Download episode 12 again')
    expect(episodeDownloadLabel(item('queued'), '12')).toBe('Episode 12 is queued to download')
    expect(episodeDownloadLabel(item('downloading', 1, 4), '12')).toBe('Downloading episode 12, 25%')
    expect(episodeDownloadLabel(item('paused', 1, 2), '12')).toBe('Episode 12 download paused at 50%')
    expect(episodeDownloadLabel(item('done'), 'A1071')).toBe('Episode A1071 is downloaded')
  })
})

describe('the per-episode download button markup', () => {
  const button = read('./EpisodeDownload.svelte')
  const card = read('./EpisodeCard.svelte')
  const list = read('./EpisodeList.svelte')

  it('is a focusable button with its hook, state and progress', () => {
    expect(button).toContain('<button type="button" data-part="episode.download" data-state={downloadState} data-focusable disabled={!released}')
    expect(button).toContain('style:--download-progress="{percent}%"')
  })

  it('stops its press at itself, queues with the download defaults and otherwise opens Downloads', () => {
    expect(button).toMatch(/function press\(event: MouseEvent\) \{\s+event\.stopPropagation\(\)/)
    expect(button).toContain('enqueue(media, ep, { quality: $downloadQuality, cachedOnly: $downloadCachedOnly, audio: $downloadAudio, codec: $downloadCodec })')
    expect(button).toContain("void goto('/app/downloads')")
    expect(button).not.toContain('playEpisode')
  })

  it('ends every built-in and template card, outside select mode only', () => {
    expect(card).toContain('const downloadButton = $derived(download && !selecting)')
    expect(card.match(/\{#if downloadButton\}<EpisodeDownload \{media\} \{ep\} \{dl\} \{released\} numberLabel=\{shownNumber\} \/>\{\/if\}/g)).toHaveLength(3)
    // The template card's button follows the template; the read-only badge gives way to it.
    expect(card).toMatch(/<ThemeNode node=\{themeCard\} model=\{themeModel\} \/>\s+\{#if downloadButton\}<EpisodeDownload/)
    expect(card).toContain('{:else if dl && !downloadButton}')
  })

  it('never lets a key pressed on a control inside an episode play it', () => {
    expect(card).toContain("onkeydown={(e) => { if (released && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play() } }}")
    expect(list).toContain("onkeydown={(e) => { if (!resolving && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap(ep) } }}")
  })

  it("follows the theme's key, leaves it out offline and draws it on the compact rows too", () => {
    expect(list).toContain("const downloadButtons = $derived(episodeTheme?.download === 'button' && !offline)")
    expect(list.match(/download=\{downloadButtons\}/g)).toHaveLength(2)
    expect(list).toContain('{#if downloadButtons && !selecting}<EpisodeDownload {media} {ep} {dl} {released} numberLabel={numberLabel(ep)} />{/if}')
    expect(list).toContain('{#if dl && !selecting && !downloadButtons}')
  })
})
