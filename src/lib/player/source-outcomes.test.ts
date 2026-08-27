import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { saveLocalHistory } from '$lib/settings/ui'
import { incognito } from '$lib/stores/incognito'
import {
  advancePlaybackStability,
  beginSourceObservation,
  classifyPlaybackFailure,
  forgetSourceOutcomes,
  markSourceObservation,
  SourceOutcomeJournal,
  sourceOutcomeContext,
  sourceOutcomeEvents,
  sourceOutcomeSummary,
  type OutcomeStorage,
  type SourceOutcomeContext,
} from './source-outcomes'

class MemoryStorage implements OutcomeStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

const context: SourceOutcomeContext = {
  family: 'torrent-extension',
  sourceId: 'source-id',
  transport: 'direct-p2p',
  serverId: 'srv-id',
}

describe('SourceOutcomeJournal', () => {
  it('records staged, deduplicated aggregate outcomes and timings', () => {
    const storage = new MemoryStorage()
    let now = 1_000
    const journal = new SourceOutcomeJournal(storage, () => true, () => now)
    const attempt = journal.begin(context, true)
    now = 1_200; journal.mark(attempt, 'resolving')
    now = 1_700; journal.mark(attempt, 'resolved')
    journal.mark(attempt, 'resolved')
    now = 2_400; journal.mark(attempt, 'player-ready')
    now = 3_000; journal.mark(attempt, 'first-frame')
    now = 35_000; journal.mark(attempt, 'stable')
    now = 80_000; journal.mark(attempt, 'completed')

    expect(journal.summary(context)).toMatchObject({
      attempts: 1,
      resolved: 1,
      firstFrames: 1,
      stable: 1,
      completed: 1,
      failures: 0,
      resolveMs: 700,
      firstFrameMs: 2_000,
    })
    expect(journal.sessionEvents().map((event) => event.stage)).toEqual([
      'selected', 'resolving', 'resolved', 'player-ready', 'first-frame', 'stable', 'completed',
    ])
    expect(storage.data.size).toBe(1)
  })

  it('attributes failures to their stage without treating cancellation as failure', () => {
    const journal = new SourceOutcomeJournal(new MemoryStorage())
    const failed = journal.begin(context)
    journal.mark(failed, 'resolving')
    journal.fail(failed, 'metadata')
    const canceled = journal.begin(context)
    journal.cancel(canceled)

    expect(journal.summary(context)).toMatchObject({ attempts: 2, failures: 1, cancellations: 1 })
    expect(journal.summary(context)?.failureClasses).toEqual({ metadata: 1 })
    expect(journal.sessionEvents().at(-2)).toMatchObject({
      stage: 'selected',
    })
    expect(journal.sessionEvents().find((event) => event.stage === 'failed')).toMatchObject({
      failureClass: 'metadata', failedAt: 'resolving',
    })
  })

  it('records nothing when privacy policy disables observation', () => {
    const storage = new MemoryStorage()
    const journal = new SourceOutcomeJournal(storage, () => false)
    expect(journal.begin(context)).toBeNull()
    expect(journal.allSummaries()).toEqual([])
    expect(journal.sessionEvents()).toEqual([])
    expect(storage.data.size).toBe(0)
  })

  it('clears both persisted aggregates and session diagnostics', () => {
    const storage = new MemoryStorage()
    const journal = new SourceOutcomeJournal(storage)
    journal.begin(context)
    expect(storage.data.size).toBe(1)
    journal.clear()
    expect(journal.allSummaries()).toEqual([])
    expect(journal.sessionEvents()).toEqual([])
    expect(storage.data.size).toBe(0)
  })
})

describe('advancePlaybackStability', () => {
  it('requires real clock advancement and ignores a seek jump', () => {
    let state = { advancedSeconds: 0 }
    ;({ state } = advancePlaybackStability(state, 5))
    ;({ state } = advancePlaybackStability(state, 15))
    ;({ state } = advancePlaybackStability(state, 300))
    expect(state.advancedSeconds).toBe(10)
    ;({ state } = advancePlaybackStability(state, 310))
    const result = advancePlaybackStability(state, 320)
    expect(result.stable).toBe(true)
  })
})

describe('source outcome privacy', () => {
  it('derives only opaque source/server context from a credential-bearing URL', () => {
    const token = 'secret-token'
    const derived = sourceOutcomeContext({
      url: `https://cdn.example/${token}/episode.mkv`,
      __origin: { kind: 'addon', id: 'opaque-addon' },
    }, 'http')
    expect(JSON.stringify(derived)).not.toContain(token)
    expect(JSON.stringify(derived)).not.toContain('cdn.example')
    expect(derived).toMatchObject({ family: 'addon', sourceId: 'opaque-addon', transport: 'http' })
    expect(derived.serverId).toMatch(/^srv-[a-f0-9]{16}$/)
  })

  it('enforces the real incognito and local-history gates', () => {
    const previousHistory = get(saveLocalHistory)
    const candidate = { __origin: { kind: 'online-extension' as const, id: 'privacy-read-gate' } }
    try {
      incognito.set(false)
      saveLocalHistory.set(true)
      const attempt = beginSourceObservation(candidate, 'http')
      markSourceObservation(attempt, 'stable')
      expect(sourceOutcomeSummary(candidate, 'http')).toBeDefined()
      incognito.set(true)
      expect(beginSourceObservation({}, 'http')).toBeNull()
      expect(sourceOutcomeSummary(candidate, 'http')).toBeUndefined()
      expect(sourceOutcomeEvents()).toEqual([])
      incognito.set(false)
      saveLocalHistory.set(false)
      expect(beginSourceObservation({}, 'http')).toBeNull()
      expect(sourceOutcomeSummary(candidate, 'http')).toBeUndefined()
      expect(sourceOutcomeEvents()).toEqual([])
    } finally {
      incognito.set(false)
      saveLocalHistory.set(previousHistory)
      forgetSourceOutcomes()
    }
  })
})

describe('classifyPlaybackFailure', () => {
  it.each([
    ['Could not fetch torrent metadata', 'metadata'],
    ['Real-Debrid resolver refused the release', 'resolver'],
    ['P2P source is too slow; no peers', 'stalled'],
    ['HTTP 403 Forbidden', 'auth'],
    ['Not available in your region', 'geo'],
    ['Wrong short video detected', 'wrong-content'],
    ['Source ended before the episode finished', 'wrong-content'],
    ['mpv player load error', 'player'],
  ])('classifies %s', (message, expected) => {
    expect(classifyPlaybackFailure(message)).toBe(expected)
  })
})
