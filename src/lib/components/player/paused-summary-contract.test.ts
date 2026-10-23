import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('paused summary (theme API 6 `player.paused: "summary"`)', () => {
  it('hooks the summary, its lines and the episode lookup', () => {
    const summary = read('./PausedSummary.svelte')
    for (const part of ['summary', 'summary.kicker', 'summary.title', 'summary.season', 'summary.episode', 'summary.synopsis', 'summary.state']) {
      expect(summary).toContain(`data-part="player.${part}"`)
    }
    expect(summary).toContain('loadEpisodeMeta(')
  })

  it('shows after five idle seconds paused and lets any input restart the wait', () => {
    const overlay = read('./PlayerOverlay.svelte')
    for (const needle of [
      'resolvePlayerControls(',
      'inputTick++',
      '(transportPaused && !pausedIdle)',
      '{#if pausedIdle}',
    ]) expect(overlay, needle).toContain(needle)
  })
})
