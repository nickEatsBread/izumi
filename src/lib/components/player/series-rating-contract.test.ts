import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Wiring contract for the end-of-series rating prompt: it is raised from every path an episode can
// complete on, mounted app-wide, and owns the controller while up.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const play = read('../../stremio/play.ts')
const layout = read('../../../routes/app/+layout.svelte')
const prompt = read('./SeriesRatingPrompt.svelte')
const gamepad = read('../../nav/gamepad.ts')
const overlay = read('./PlayerOverlay.svelte')
const androidTracking = read('../../player/android-tracking.ts')
const settings = read('../../settings/ui.ts')
const synced = read('../../sync/manual.ts')

describe('series rating prompt contract', () => {
  it('is raised at EOF and on close after the watch threshold, on both players', () => {
    // Desktop EOF, gated on a genuine (non-truncated) finish.
    expect(play).toContain('if (lastDuration > 0 && !prematureEof(lastPosition, lastDuration, media.duration)) requestSeriesRating(media, episode)')
    // Desktop close after 85%.
    expect(play).toContain('if (watched(pos, dur)) requestSeriesRating(media, episode)')
    // Android EOF + close.
    expect(play).toContain("clearPosition(media.id, episode)\n    requestSeriesRating(media, episode)")
    expect(play).toContain('if (currentMedia && watched(pos, dur)) requestSeriesRating(currentMedia, np.episode)')
    // External Android player: returning to izumi is the completion signal.
    expect(androidTracking).toContain('requestSeriesRating(p.media, p.episode)')
  })

  it('mounts once at app level, beside Up Next, and outlives the player', () => {
    expect(layout).toContain('<UpNextOverlay />')
    expect(layout).toContain('<SeriesRatingPrompt />')
    // Unlike Up Next there is no "clear when the player closes" effect: the finale reached by
    // backing out asks over the series page.
    expect(prompt).not.toContain('!$playing && !$androidMpvActive')
  })

  it('owns keyboard and controller input while open', () => {
    expect(prompt).toContain('data-nav-trap')
    expect(prompt).toContain("window.addEventListener('series-rating-close', close)")
    expect(gamepad).toContain("window.dispatchEvent(new Event('series-rating-close'))")
    expect(overlay).toContain('if (get(seriesRatingPrompt)) return')
    // Arrow keys move the score, never the playhead underneath.
    expect(prompt).toContain("if (e.key === 'ArrowRight' || e.key === 'ArrowUp')")
    expect(prompt).toContain('e.stopPropagation()')
  })

  it('is a per-profile-synced, default-on preference with an in-prompt opt out', () => {
    expect(settings).toContain("persisted<boolean>('player-series-rating-prompt', true)")
    expect(synced).toContain('"player-series-rating-prompt"')
    expect(prompt).toContain('seriesRatingPromptEnabled.set(false)')
  })

  it('uses a ten-segment scale with the descriptor under it, not a stepper', () => {
    expect(prompt).toContain('role="radiogroup"')
    expect(prompt).toContain('data-score={n}')
    expect(prompt).toContain('SCORE_LABELS[shown]')
    expect(prompt).not.toContain('changeScore(')
  })
})
