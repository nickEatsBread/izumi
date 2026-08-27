import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { debridProvider, saveLocalHistory } from '$lib/settings/ui'
import { incognito } from '$lib/stores/incognito'
import {
  advancePlaybackStability,
  beginSourceObservation,
  classifyPlaybackFailure,
  forgetSourceOutcomes,
  markSourceObservation,
  OUTCOME_HALF_LIFE_MS,
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

    expect(journal.summary(context)?.automatic).toMatchObject({
      attempts: expect.closeTo(1, 4),
      startupSuccesses: expect.closeTo(1, 4),
      startupFailures: 0,
      stableSuccesses: expect.closeTo(1, 4),
      playbackFailures: 0,
      resolveSamples: expect.closeTo(1, 4),
      firstFrameSamples: expect.closeTo(1, 4),
      resolveMs: 700,
      firstFrameMs: 2_000,
    })
    expect(journal.sessionEvents().map((event) => event.stage)).toEqual([
      'selected', 'resolving', 'resolved', 'player-ready', 'first-frame', 'stable', 'completed',
    ])
    expect(journal.allSummaries()).toHaveLength(1)
    expect(storage.data.size).toBe(1)
  })

  it('attributes failures to their stage without treating cancellation as failure', () => {
    const journal = new SourceOutcomeJournal(new MemoryStorage())
    const failed = journal.begin(context)
    journal.mark(failed, 'resolving')
    journal.fail(failed, 'metadata')
    const canceled = journal.begin(context)
    journal.cancel(canceled)

    expect(journal.summary(context)?.manual).toMatchObject({
      attempts: expect.closeTo(2, 4),
      startupFailures: expect.closeTo(1, 4),
      playbackFailures: 0,
      cancellations: expect.closeTo(1, 4),
    })
    expect(journal.summary(context)?.manual.failureClasses.metadata).toBeCloseTo(1, 6)
    expect(journal.sessionEvents().at(-2)).toMatchObject({
      stage: 'selected',
    })
    expect(journal.sessionEvents().find((event) => event.stage === 'failed')).toMatchObject({
      failureClass: 'metadata', failedAt: 'resolving',
    })
  })

  it('counts a late failure as one sustained outcome rather than success plus failure', () => {
    let now = 1_000
    const journal = new SourceOutcomeJournal(new MemoryStorage(), () => true, () => now)
    const attempt = journal.begin(context, true)
    now += 2_000; journal.mark(attempt, 'first-frame')
    now += 30_000; journal.mark(attempt, 'stable')
    now += 10_000; journal.fail(attempt, 'stalled')

    expect(journal.summary(context)?.automatic).toMatchObject({
      startupSuccesses: expect.closeTo(1, 4),
      stableSuccesses: 0,
      playbackFailures: expect.closeTo(1, 4),
    })
  })

  it('treats stable playback as startup evidence when a backend omits first-frame', () => {
    const journal = new SourceOutcomeJournal(new MemoryStorage())
    const attempt = journal.begin(context, true)
    journal.mark(attempt, 'stable')
    expect(journal.summary(context)?.automatic).toMatchObject({
      startupSuccesses: expect.closeTo(1, 4),
      stableSuccesses: expect.closeTo(1, 4),
    })
  })

  it('discounts old evidence before adding a new result instead of reviving it', () => {
    let now = 0
    const journal = new SourceOutcomeJournal(new MemoryStorage(), () => true, () => now)
    const old = journal.begin(context, true)
    journal.mark(old, 'first-frame')
    journal.mark(old, 'stable')

    now = OUTCOME_HALF_LIFE_MS
    expect(journal.summary(context)?.automatic.startupSuccesses).toBeCloseTo(0.5, 6)
    const recent = journal.begin(context, true)
    journal.fail(recent, 'stalled')
    expect(journal.summary(context)?.automatic).toMatchObject({
      startupSuccesses: expect.closeTo(0.5, 6),
      startupFailures: 1,
      attempts: 1.5,
    })
  })

  it('does not double-discount evidence when the wall clock moves backwards', () => {
    let now = OUTCOME_HALF_LIFE_MS
    const journal = new SourceOutcomeJournal(new MemoryStorage(), () => true, () => now)
    journal.mark(journal.begin(context, true), 'stable')
    now = 0
    expect(journal.summary(context)?.automatic.startupSuccesses).toBe(1)
    now = 2 * OUTCOME_HALF_LIFE_MS
    expect(journal.summary(context)?.automatic.startupSuccesses).toBeCloseTo(0.5, 6)
  })

  it('keeps automatic and manually selected evidence in separate channels', () => {
    const journal = new SourceOutcomeJournal(new MemoryStorage())
    const automatic = journal.begin(context, true)
    journal.mark(automatic, 'stable')
    const manual = journal.begin(context, false)
    journal.fail(manual, 'metadata')
    expect(journal.summary(context)).toMatchObject({
      automatic: { startupSuccesses: expect.closeTo(1, 4), startupFailures: 0 },
      manual: { startupSuccesses: 0, startupFailures: expect.closeTo(1, 4) },
    })
  })

  it('shares HTTP evidence with a provider fallback but keeps P2P swarm evidence local', () => {
    const journal = new SourceOutcomeJournal(new MemoryStorage())
    const http = { ...context, transport: 'http' as const }
    journal.mark(journal.begin(http, true), 'stable')
    expect(journal.allSummaries()).toHaveLength(2)

    const p2p = { ...context, sourceId: 'another-source', transport: 'direct-p2p' as const }
    journal.mark(journal.begin(p2p, true), 'stable')
    expect(journal.allSummaries().filter((summary) => summary.context.sourceId === 'another-source')).toHaveLength(1)
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
    expect(derived.profileId).toMatch(/^prf-[a-f0-9]{16}$/)
  })

  it('separates release profiles and debrid services without persisting their names', () => {
    const previous = get(debridProvider)
    try {
      debridProvider.set('realdebrid')
      const first = sourceOutcomeContext({
        infoHash: 'a'.repeat(40),
        title: '[Group A] Show - 01 [1080p] [1.2 GB]',
        __evidence: { releaseGroup: 'Group A' },
        __origin: { kind: 'addon', id: 'torrentio' },
      }, 'debrid')
      debridProvider.set('torbox')
      const second = sourceOutcomeContext({
        infoHash: 'b'.repeat(40),
        title: '[Group B] Show - 01 [1080p] [1.2 GB]',
        __evidence: { releaseGroup: 'Group B' },
        __origin: { kind: 'addon', id: 'torrentio' },
      }, 'debrid')
      expect(first.profileId).not.toBe(second.profileId)
      expect(first.serviceId).not.toBe(second.serviceId)
      expect(JSON.stringify([first, second])).not.toMatch(/realdebrid|torbox|group a|group b/i)
    } finally {
      debridProvider.set(previous)
    }
  })

  it('prefers Stremio bingeGroup continuity and separates materially different swarms', () => {
    const base = {
      infoHash: 'a'.repeat(40),
      __origin: { kind: 'addon' as const, id: 'stremio-addon' },
      behaviorHints: { bingeGroup: 'same-show-1080p' },
    }
    const first = sourceOutcomeContext({
      ...base,
      __seeders: 2,
      __evidence: { releaseGroup: 'Conflicting A' },
    }, 'direct-p2p')
    const sameContinuity = sourceOutcomeContext({
      ...base,
      infoHash: 'b'.repeat(40),
      __seeders: 3,
      __evidence: { releaseGroup: 'Conflicting B' },
    }, 'direct-p2p')
    const healthierSwarm = sourceOutcomeContext({
      ...base,
      infoHash: 'c'.repeat(40),
      __seeders: 40,
    }, 'direct-p2p')
    expect(first.profileId).toBe(sameContinuity.profileId)
    expect(first.profileId).not.toBe(healthierSwarm.profileId)
  })

  it('does not read a broad P2P aggregate left by an older v2 journal', () => {
    const previousHistory = get(saveLocalHistory)
    const broad = { __origin: { kind: 'addon' as const, id: 'legacy-p2p-provider' } }
    try {
      incognito.set(false)
      saveLocalHistory.set(true)
      forgetSourceOutcomes()
      markSourceObservation(beginSourceObservation(broad, 'direct-p2p'), 'stable')
      expect(sourceOutcomeSummary({ ...broad, infoHash: 'd'.repeat(40) }, 'direct-p2p')).toBeUndefined()
    } finally {
      saveLocalHistory.set(previousHistory)
      forgetSourceOutcomes()
    }
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
