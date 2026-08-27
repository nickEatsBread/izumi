import { describe, expect, it } from 'vitest'
import type { PlaybackTransport, SourceOutcomeSummary } from '$lib/player/source-outcomes'
import { dedupeStreams } from './dedupe'
import { normalizeCandidates } from './candidate-model'
import { describe as describeStream, languageMismatch, rankStreams } from './addon'
import { normalizeStreamBehavior } from './stream-behavior'
import { planRecoveryCandidates, planSources } from './source-planner'
import type { Stream } from './parse'

// Deliberately opt-in: this exercises a third-party Stremio addon and must not make ordinary CI
// depend on its uptime. Set IZUMI_LIVE_SOURCE_TEST=1 in the environment, then run
// `npm test -- source-planner.live.test.ts`.
const live = describe.skipIf(process.env.IZUMI_LIVE_SOURCE_TEST !== '1')
const ADDON = 'https://torrentio.strem.fun'
const CASES = [
  // AniList 154587 / TMDB 209867
  { title: 'Frieren: Beyond Journey\'s End', id: 'tt22248376:1:1' },
  // AniList 171018 / TMDB 240411
  { title: 'Dandadan', id: 'tt30217403:1:1' },
  // AniList 1 / TMDB 30991
  { title: 'Cowboy Bebop', id: 'tt0213338:1:1' },
] as const

async function fetchStreams(id: string): Promise<Stream[]> {
  const response = await fetch(`${ADDON}/stream/series/${id}.json`, {
    signal: AbortSignal.timeout(30_000),
  })
  expect(response.ok, `${id} returned HTTP ${response.status}`).toBe(true)
  const body = await response.json() as { streams?: Stream[] }
  return dedupeStreams((body.streams ?? []).map((stream, upstreamRank) => normalizeStreamBehavior({
    ...stream,
    __addonName: 'Torrentio',
    __origin: { kind: 'addon', id: 'live-torrentio', name: 'Torrentio' },
    __evidence: { upstreamRank, requestId: id },
  })))
}

function hardKey(stream: Stream): string {
  const info = describeStream(stream)
  return [info.cached, info.quality, languageMismatch(info, 'jpn'), -1].join('|')
}

function observed(stable: boolean): SourceOutcomeSummary {
  return {
    context: { family: 'addon', sourceId: 'live-torrentio', transport: 'direct-p2p' },
    attempts: 8,
    resolved: stable ? 8 : 0,
    firstFrames: stable ? 8 : 0,
    stable: stable ? 8 : 0,
    completed: 0,
    failures: stable ? 0 : 8,
    cancellations: 0,
    failureClasses: stable ? {} : { stalled: 8 },
    firstFrameMs: stable ? 2_500 : undefined,
    lastAt: Date.now(),
  }
}

live('adaptive source planner against live Stremio P2P results', () => {
  it('ingests varied AniList/TMDB identities without losing standard Stremio fields', async () => {
    const results = await Promise.all(CASES.map(async (entry) => ({
      ...entry,
      streams: await fetchStreams(entry.id),
    })))

    for (const result of results) {
      expect(result.streams.length, `${result.title} returned no usable streams`).toBeGreaterThan(0)
      expect(result.streams.every((stream) => /^[a-f\d]{40}$/i.test(stream.infoHash ?? ''))).toBe(true)
      expect(result.streams.some((stream) => stream.fileIdx != null)).toBe(true)
      expect(result.streams.every((stream) => !!stream.behaviorHints)).toBe(true)
      expect(result.streams.every((stream) => stream.__evidence?.requestId === result.id)).toBe(true)
      expect(result.streams.every((stream) => stream.__origin?.id === 'live-torrentio')).toBe(true)
    }
  }, 45_000)

  it('learns only inside safety-equivalent buckets and limits movement to two places', async () => {
    const baseline = rankStreams(await fetchStreams(CASES[0].id))
    const buckets = new Map<string, Stream[]>()
    for (const stream of baseline) buckets.set(hardKey(stream), [...(buckets.get(hardKey(stream)) ?? []), stream])
    const pair = [...buckets.values()].find((bucket) => bucket.length >= 2)
    expect(pair).toBeDefined()
    const summaries = new Map<Stream, SourceOutcomeSummary>([
      [pair![0], observed(false)],
      [pair![1], observed(true)],
    ])
    const outcomeOf = (stream: Stream, _transport: PlaybackTransport) => summaries.get(stream)
    const plan = planSources(baseline, { directP2p: true, audioLang: 'jpn', outcomeOf })

    expect(plan.changed).toBe(true)
    expect(plan.planned).toHaveLength(baseline.length)
    expect(new Set(plan.planned)).toEqual(new Set(baseline))
    plan.planned.forEach((stream, index) => expect(hardKey(stream)).toBe(hardKey(baseline[index])))
    for (const bucket of buckets.values()) {
      const after = plan.planned.filter((stream) => hardKey(stream) === hardKey(bucket[0]))
      for (const stream of bucket) {
        expect(Math.abs(after.indexOf(stream) - bucket.indexOf(stream))).toBeLessThanOrEqual(2)
      }
    }
  }, 45_000)

  it('treats duplicate offers as one release and abandons it after wrong-content evidence', async () => {
    const candidates = normalizeCandidates(await fetchStreams(CASES[1].id))
    const releases = new Map<string, Stream[]>()
    for (const stream of candidates) {
      const id = stream.__candidate!.releaseId
      releases.set(id, [...(releases.get(id) ?? []), stream])
    }
    const duplicate = [...releases.values()].find((release) => release.length >= 2)
    expect(duplicate).toBeDefined()
    const [failed] = duplicate!
    const recovery = planRecoveryCandidates(
      candidates.filter((candidate) => candidate !== failed),
      failed,
      'wrong-content',
      { directP2p: true, audioLang: 'jpn' },
    )
    expect(recovery.length).toBeGreaterThan(0)
    expect(recovery.every((stream) => stream.__candidate?.releaseId !== failed.__candidate?.releaseId)).toBe(true)
  }, 45_000)
})
