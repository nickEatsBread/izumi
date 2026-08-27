import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const play = readFileSync(fileURLToPath(new URL('./play.ts', import.meta.url)), 'utf8')
const settings = readFileSync(fileURLToPath(new URL('../../routes/app/settings/sources/+page.svelte', import.meta.url)), 'utf8')

describe('adaptive source rollout integration', () => {
  it('keeps active selection behind an explicit rollout mode', () => {
    expect(play).toContain("if (get(adaptiveSourceMode) !== 'active') return baseline")
    expect(settings).toContain("{ value: 'active', label: 'On — adapt automatic choices' }")
    expect(settings).toContain("{ value: 'shadow', label: 'Preview — learn without changing playback' }")
  })

  it('uses the same active plan for startup readiness and watchdog recovery', () => {
    expect(play).toContain('const top = activeSourceCandidates(baseline, directP2p, options)[0]')
    expect(play).toContain('const adaptiveRanked = activeSourceCandidates(startupRanked, directP2p, options)')
    expect(play).toContain('planRecoveryCandidates(adaptiveRanked, failed ?? undefined, failureClass')
  })

  it('retains strict source filtering during recovery', () => {
    expect(play).toContain('const allowedStreams = applyPriorityFilter(streams, get(sourcePriority), get(sourcePriorityMode))')
    expect(play).toContain('pickCandidates(\n    allowedStreams,')
  })
})
