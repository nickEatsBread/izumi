import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The Skip button carries styling hooks so a theme can restyle it. The Up Next countdown card is gone:
// the next episode starts by itself (Settings → Auto-play next episode).
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

describe('Skip styling hooks', () => {
  it('the Skip button is a player.skip part named by its segment kind', () => {
    expect(read('PlayerOverlay.svelte')).toContain('data-part="player.skip" data-kind={currentSeg.type}')
  })

  it('has no Up Next countdown card or setting', () => {
    expect(existsSync(fileURLToPath(new URL('./UpNextOverlay.svelte', import.meta.url)))).toBe(false)
    const play = readFileSync(fileURLToPath(new URL('../../stremio/play.ts', import.meta.url)), 'utf8')
    expect(play).not.toContain('upNextPrompt')
    // Auto-play goes straight to the next episode, with no prompt in between.
    const next = play.slice(play.indexOf('function continueToNextEpisode('), play.indexOf('import { shouldBeginNextEpisodePreload'))
    expect(next).toContain('resolveAndPlayBest(media, nextEpisode, onState, true)')
    expect(next).not.toMatch(/setTimeout|seconds/)
    expect(readFileSync(fileURLToPath(new URL('../../settings/ui.ts', import.meta.url)), 'utf8')).not.toContain('player-up-next-overlay')
  })
})
