import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { durableHistory, recordPlay } from '$lib/player/history'
import { releaseMedia } from './release-media'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const body = (source: string, signature: string) => source.split(signature)[1].split('\nexport ')[0]

describe('search box releases stay out of history and trackers', () => {
  it('never records a release in watch history, while a title still is', () => {
    const release = releaseMedia({ infoHash: 'ab'.repeat(20), title: 'Quiet Harbor 05' })
    recordPlay(release, 1)
    expect(get(durableHistory)[release.id]).toBeUndefined()
    const title = { id: 424242, title: { romaji: 'Example' }, episodes: 12 } as Media
    recordPlay(title, 1)
    expect(get(durableHistory)[title.id]).toBeDefined()
  })

  it('never syncs a release to a tracker', () => {
    expect(body(read('../trackers/index.ts'), 'export function markWatched(')).toContain('if (media.release) return 0')
  })
})

describe('playStream treats a release as its own torrent, not a title', () => {
  const play = read('../stremio/play.ts')

  it('asks a pack for the searched episode exactly, and a single release for its main video', () => {
    const want = body(play, 'export async function episodeWant(')
    expect(want).toContain('if (media.release) return media.release.pack')
    expect(want).toContain('{ episode, season: media.release.season, filename: stream?.behaviorHints?.filename, strict: true }')
  })

  it('never looks other sources up by a release name', () => {
    expect(body(play, 'export async function playEpisode(')).toContain('if (media.release) {')
    expect(body(play, 'export async function recoverPlaybackSource(')).toContain('if (context.media.release) {')
    expect(play).toContain('if (media.release || (!get(bingePreload) && !get(autoplayNext))) return')
  })

  it('skips title-bound subtitle search and source memory, and remembers the release instead', () => {
    expect(play).toContain('|| get(offlineMode) || !!media.release')
    expect(play).toMatch(/const rememberSuccess = \(\) => \{\n\s*\/\/[^\n]*\n\s*if \(media\.release\) return/)
    expect(play).toContain('if (media.release && episode != null) rememberRelease({')
  })

  it('offers Next only inside a pack, and replays the same torrent for it', () => {
    expect(play).toContain('const airedTotal = media.release?.pack && episode != null ? episode + 1 : airedTotalOf(media) || null')
    // Desktop and Android each have their own end-of-file handler; both advance inside a pack.
    expect(play.split('const airedTotal = media.release?.pack ? episode + 1 : airedTotalOf(media)\n').length - 1).toBe(2)
    expect(play).toContain('if (media.release) return playStream(media, episode, media.release.stream, onState, { autoplay, keepMini: true })')
    expect(body(play, 'export function playNext(')).toContain("if (currentMedia.release && !currentMedia.release.pack) return onState({ status: 'error', message: 'This release has no next episode.' })")
  })
})

describe('search box mode wiring', () => {
  it('renders the search screen on Home and pauses the catalog hero', () => {
    const home = read('../../routes/app/home/+page.svelte')
    expect(home).toContain("const searchMode = $derived($interfaceMode === 'search')")
    expect(home).toContain('const usesAniListHome = $derived(!searchMode && (')
    expect(home).toContain('{#if searchMode}\n  <ReleaseSearchHome />\n{:else if $offlineMode}')
  })

  it('offers the Interface choice in Settings', () => {
    expect(read('../../routes/app/settings/library/+page.svelte')).toContain('settingKey="interface-mode"')
  })
})

describe('a release stays a release outside the player core', () => {
  it('is shared without its magnet or .torrent link, never downloaded or bookmarked, and kept off public presence', () => {
    expect(read('../watch-together/client.ts')).toContain('media: shareableReleaseMedia(current.media)')
    expect(body(read('../downloads/store.ts'), 'export function enqueue(')).toContain('if (media.release) return')
    expect(read('../components/player/WatchToolbar.svelte')).toContain("media?.release ? items.filter((item) => item !== 'download') : items")
    for (const file of ['Controls.svelte', 'PlayerOverlay.svelte', 'AndroidPlayer.svelte']) {
      expect(read(`../components/player/${file}`)).toContain('if (current.media.release) {')
    }
    expect(read('../player/android-tracking.ts')).toContain('if (p.media.release) return')
    expect(read('../components/player/PlayerOverlay.svelte')).toContain('private: !!media?.isAdult || !!media?.release ||')
  })
})

describe('a release name stays on this device', () => {
  it('never searches comment providers by a release name', () => {
    expect(body(read('../comments/index.ts'), 'export function fetchDiscussion(')).toContain('if (media.release) return Promise.resolve([])')
  })
})
