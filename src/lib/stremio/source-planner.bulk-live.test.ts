import { describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({
  requests: new Map<string, number>(),
  statuses: new Map<number, number>(),
  streamStatuses: new Map<number, number>(),
  nextStreamAt: 0,
}))

// Production HTTP is a Tauri command. The opt-in live test keeps every production parser and
// planner in place, replacing only that IPC boundary with Node's fetch implementation.
vi.mock('$lib/net/http', () => {
  const record = (rawUrl: string, status: number) => {
    const url = new URL(rawUrl)
    const target = `${url.hostname}${url.pathname}`
    network.requests.set(target, (network.requests.get(target) ?? 0) + 1)
    network.statuses.set(status, (network.statuses.get(status) ?? 0) + 1)
    if (/\/stream\//.test(url.pathname)) {
      network.streamStatuses.set(status, (network.streamStatuses.get(status) ?? 0) + 1)
    }
  }
  const request = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {},
  ) => {
    const parsed = new URL(url)
    if (/\/stream\//.test(parsed.pathname)) {
      const now = Date.now()
      const wait = Math.max(0, network.nextStreamAt - now)
      network.nextStreamAt = Math.max(now, network.nextStreamAt) + 500
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    }
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.method === 'GET' ? undefined : init.body,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    })
    record(url, response.status)
    return { status: response.status, body: await response.text() }
  }
  return {
    invokeNativeHttp: async (
      command: 'http_get' | 'http_post' | 'ext_fetch',
      args: { url: string; headers?: Record<string, string>; body?: string; method?: string },
      options?: { signal?: AbortSignal },
    ) => request(args.url, {
      method: command === 'http_get' ? 'GET' : command === 'http_post' ? 'POST' : (args.method ?? 'GET'),
      headers: args.headers,
      body: args.body,
      signal: options?.signal,
    }),
    phttp: async (
      url: string,
      init?: { headers?: Record<string, string>; signal?: AbortSignal },
    ) => {
      const response = await request(url, { headers: init?.headers, signal: init?.signal })
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => JSON.parse(response.body),
        text: async () => response.body,
      }
    },
  }
})

import {
  sourceOutcomeContext,
  type PlaybackTransport,
  type SourceOutcomeCounts,
  type SourceOutcomeSummary,
} from '$lib/player/source-outcomes'
import { candidateIds, normalizeCandidates } from './candidate-model'
import { describe as describeStream, languageMismatch, rankStreams } from './addon'
import { fetchAddonStreams } from './addon'
import { torbox } from './debrid/providers/torbox'
import { fetchManifest } from './manifest'
import type { Stream } from './parse'
import { planRecoveryCandidates, planSources } from './source-planner'
import { buildStreamIds } from './stream-ids'

const enabled = process.env.IZUMI_LIVE_SOURCE_500_TEST === '1'
const live = describe.skipIf(!enabled)
const ADDON = process.env.IZUMI_LIVE_STREMIO_ADDON?.trim() || 'https://torrentio.strem.fun'
const TMDB_TOKEN = process.env.IZUMI_TMDB_TOKEN?.trim() || ''
const TORBOX_KEY = process.env.IZUMI_TORBOX_KEY?.trim() || ''
const ANILIST = 'https://graphql.anilist.co'
const ANIZIP = 'https://api.ani.zip/mappings'
const TMDB = 'https://api.themoviedb.org/3'
const CINEMETA = 'https://v3-cinemeta.strem.io'

const ERAS = [
  { id: 'classic', from: 1960, to: 1989 },
  { id: 'turn-of-century', from: 1990, to: 2004 },
  { id: 'early-streaming', from: 2005, to: 2014 },
  { id: 'modern', from: 2015, to: 2020 },
  { id: 'current', from: 2021, to: 2026 },
] as const

type CatalogSource = 'anilist' | 'tmdb'
type MediaKind = 'series' | 'movie'

interface AniZipMapping {
  mappings?: {
    kitsu_id?: number
    imdb_id?: string
    themoviedb_id?: string
  }
  episodes?: Record<string, { seasonNumber?: number; episodeNumber?: number }>
}

interface EvaluationTitle {
  source: CatalogSource
  kind: MediaKind
  catalogId: string
  title: string
  year: number
  era: string
  kitsu?: number
  imdb?: string
  tmdb?: string
  season?: number
  episode?: number
  mapping?: 'anizip' | 'tmdb-api' | 'cinemeta'
}

interface EvaluatedTitle extends EvaluationTitle {
  ids: string[]
  streams: Stream[]
  rawRows: number
  elapsedMs: number
  zeroReason?: 'no-mapping' | 'addon-empty'
}

interface AniListMedia {
  id: number
  title?: { english?: string; romaji?: string }
  startDate?: { year?: number }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  attempts = 3,
): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      })
      if (response.ok) return await response.json() as T
      last = new Error(`${new URL(url).hostname} returned HTTP ${response.status}`)
      if (response.status !== 408 && response.status !== 425 && response.status !== 429 && response.status < 500) break
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 30_000) : 750 * 2 ** attempt)
    } catch (error) {
      last = error
      if (attempt + 1 < attempts) await sleep(750 * 2 ** attempt)
    }
  }
  throw last instanceof Error ? last : new Error('Request failed')
}

async function mapConcurrent<T, R>(values: readonly T[], limit: number, fn: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      output[index] = await fn(values[index], index)
    }
  }))
  return output
}

function evenly<T>(values: readonly T[], count: number): T[] {
  if (values.length < count) throw new Error(`Needed ${count} records, received ${values.length}`)
  if (count === 1) return [values[0]]
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * (values.length - 1) / (count - 1))])
}

function titleKey(title: string, year: number): string {
  return `${title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${year}`
}

async function aniListPage(format: 'TV' | 'MOVIE', page: number): Promise<Record<string, { media?: AniListMedia[] }>> {
  const aliases = ERAS.map((era, index) => `
    e${index}: Page(page: ${page}, perPage: 50) {
      media(
        type: ANIME
        format: ${format}
        isAdult: false
        startDate_greater: ${era.from}0000
        startDate_lesser: ${era.to + 1}0000
        sort: [POPULARITY_DESC]
      ) { id title { english romaji } startDate { year } }
    }`).join('\n')
  const payload = await fetchJson<{ data?: Record<string, { media?: AniListMedia[] }>; errors?: Array<{ message?: string }> }>(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: `query { ${aliases} }` }),
  })
  if (!payload.data) throw new Error(payload.errors?.[0]?.message ?? 'AniList returned no data')
  return payload.data
}

async function buildAniListTitles(kind: MediaKind): Promise<EvaluationTitle[]> {
  const format = kind === 'series' ? 'TV' : 'MOVIE'
  const [popular, middle] = await Promise.all([aniListPage(format, 1), aniListPage(format, 3)])
  const selected = ERAS.flatMap((era, index) => {
    const first = evenly(popular[`e${index}`]?.media ?? [], 13)
    const later = evenly(middle[`e${index}`]?.media ?? [], 12)
    return [...first, ...later].map((media): EvaluationTitle => ({
      source: 'anilist',
      kind,
      catalogId: String(media.id),
      title: media.title?.english ?? media.title?.romaji ?? `AniList ${media.id}`,
      year: media.startDate?.year ?? era.from,
      era: era.id,
    }))
  })
  return mapConcurrent(selected, 5, async (entry) => {
    let mapping: AniZipMapping | undefined
    try {
      mapping = await fetchJson<AniZipMapping>(`${ANIZIP}?anilist_id=${encodeURIComponent(entry.catalogId)}`, {}, 2)
    } catch { /* A mapping miss is measured, not allowed to abort the 500-title corpus. */ }
    const episode = mapping?.episodes?.['1']
    return {
      ...entry,
      kitsu: mapping?.mappings?.kitsu_id,
      imdb: mapping?.mappings?.imdb_id,
      tmdb: mapping?.mappings?.themoviedb_id,
      season: episode?.seasonNumber,
      episode: episode?.episodeNumber,
      mapping: mapping ? 'anizip' : undefined,
    }
  })
}

interface TmdbListItem {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
}

async function tmdbApi<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${TMDB}${path}`)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value))
  return fetchJson<T>(url.toString(), {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' },
  })
}

async function buildTmdbApiTitles(kind: MediaKind, excludedTmdb: Set<string>, excludedTitles: Set<string>): Promise<EvaluationTitle[]> {
  const tmdbKind = kind === 'movie' ? 'movie' : 'tv'
  const output: EvaluationTitle[] = []
  for (const era of ERAS) {
    const pages = await Promise.all([1, 3, 6].map((page) => tmdbApi<{ results?: TmdbListItem[] }>(`/discover/${tmdbKind}`, {
      page,
      sort_by: 'popularity.desc',
      include_adult: 'false',
      language: 'en-GB',
      ...(kind === 'movie'
        ? { 'primary_release_date.gte': `${era.from}-01-01`, 'primary_release_date.lte': `${era.to}-12-31` }
        : { 'first_air_date.gte': `${era.from}-01-01`, 'first_air_date.lte': `${era.to}-12-31` }),
    })))
    const candidates = pages.flatMap((page) => page.results ?? []).filter((item) => {
      const year = Number((item.release_date ?? item.first_air_date ?? '').slice(0, 4)) || era.from
      const title = item.title ?? item.name ?? `TMDB ${item.id}`
      return !excludedTmdb.has(String(item.id)) && !excludedTitles.has(titleKey(title, year))
    })
    const chosen = evenly([...new Map(candidates.map((item) => [item.id, item])).values()], 25)
    const detailed = await mapConcurrent(chosen, 6, async (item) => {
      const detail = await tmdbApi<{ external_ids?: { imdb_id?: string | null } }>(`/${tmdbKind}/${item.id}`, {
        language: 'en-GB', append_to_response: 'external_ids',
      })
      const year = Number((item.release_date ?? item.first_air_date ?? '').slice(0, 4)) || era.from
      return {
        source: 'tmdb' as const,
        kind,
        catalogId: String(item.id),
        tmdb: String(item.id),
        imdb: detail.external_ids?.imdb_id ?? undefined,
        title: item.title ?? item.name ?? `TMDB ${item.id}`,
        year,
        era: era.id,
        season: kind === 'series' ? 1 : undefined,
        episode: kind === 'series' ? 1 : undefined,
        mapping: 'tmdb-api' as const,
      }
    })
    output.push(...detailed)
    for (const item of detailed) excludedTitles.add(titleKey(item.title, item.year))
  }
  return output
}

interface CinemetaMeta {
  id?: string
  imdb_id?: string
  moviedb_id?: number | string
  name?: string
  year?: number | string
  released?: string
  videos?: Array<{ season?: number; episode?: number; id?: string }>
}

function cinemetaYear(meta: CinemetaMeta): number | undefined {
  const parsed = Number(String(meta.year ?? meta.released ?? '').match(/\d{4}/)?.[0])
  return Number.isInteger(parsed) ? parsed : undefined
}

async function buildCinemetaTmdbTitles(kind: MediaKind, excludedTmdb: Set<string>, excludedTitles: Set<string>): Promise<EvaluationTitle[]> {
  // Cinemeta's public catalog carries both IMDb and TMDB identities. Sampling twenty separated
  // pages supplies popularity strata without a broad database scan, and it exercises the same
  // metadata namespace general-purpose Stremio addons use in production.
  const offsets = Array.from({ length: 20 }, (_, index) => index * 50)
  const type = kind === 'movie' ? 'movie' : 'series'
  const pages = await mapConcurrent(offsets, 5, async (offset) =>
    fetchJson<{ metas?: CinemetaMeta[] }>(`${CINEMETA}/catalog/${type}/top/skip=${offset}.json`))
  const ranked = pages.flatMap((page) => page.metas ?? [])
  const output: EvaluationTitle[] = []
  for (const era of ERAS) {
    const candidates = [...new Map(ranked.flatMap((meta) => {
      const tmdb = meta.moviedb_id == null ? undefined : String(meta.moviedb_id)
      const imdb = meta.imdb_id ?? meta.id
      const year = cinemetaYear(meta)
      const title = meta.name ?? (tmdb ? `TMDB ${tmdb}` : '')
      if (!tmdb || !/^tt\d+$/i.test(imdb ?? '') || year == null || year < era.from || year > era.to
        || excludedTmdb.has(tmdb) || excludedTitles.has(titleKey(title, year))) return []
      return [[tmdb, { tmdb, imdb: imdb!, title, year, firstVideo: meta.videos?.[0] }] as const]
    })).values()]
    const chosen = evenly(candidates, 25).map((item): EvaluationTitle => ({
      source: 'tmdb',
      kind,
      catalogId: item.tmdb,
      tmdb: item.tmdb,
      imdb: item.imdb,
      title: item.title,
      year: item.year,
      era: era.id,
      season: kind === 'series' ? (item.firstVideo?.season ?? 1) : undefined,
      episode: kind === 'series' ? (item.firstVideo?.episode ?? 1) : undefined,
      mapping: 'cinemeta',
    }))
    output.push(...chosen)
    for (const item of chosen) excludedTitles.add(titleKey(item.title, item.year))
  }
  return output
}

async function buildCorpus(): Promise<{ titles: EvaluationTitle[]; tmdbMode: 'api' | 'cinemeta-fallback' }> {
  const [anilistSeries, anilistMovies] = await Promise.all([
    buildAniListTitles('series'),
    buildAniListTitles('movie'),
  ])
  const anilist = [...anilistSeries, ...anilistMovies]
  const excludedTmdb = new Set(anilist.flatMap((entry) => entry.tmdb ? [entry.tmdb] : []))
  const excludedTitles = new Set(anilist.map((entry) => titleKey(entry.title, entry.year)))
  const build = TMDB_TOKEN ? buildTmdbApiTitles : buildCinemetaTmdbTitles
  const tmdbSeries = await build('series', excludedTmdb, excludedTitles)
  const tmdbMovies = await build('movie', excludedTmdb, excludedTitles)
  return {
    titles: [...anilistSeries, ...anilistMovies, ...tmdbSeries, ...tmdbMovies],
    tmdbMode: TMDB_TOKEN ? 'api' : 'cinemeta-fallback',
  }
}

function streamIds(entry: EvaluationTitle): string[] {
  return buildStreamIds({
    type: entry.kind,
    kitsu: entry.kitsu,
    episode: entry.kind === 'series' ? 1 : undefined,
    imdb: entry.imdb,
    tmdb: entry.tmdb,
    season: entry.season,
    imdbEpisode: entry.episode,
  })
}

async function evaluateSources(titles: EvaluationTitle[]): Promise<EvaluatedTitle[]> {
  // Resolve the manifest before fan-out so its declared idPrefixes gate every request. Production
  // deliberately does not block the first interactive lookup on this enhancement, but a bulk run
  // would otherwise send hundreds of known-unsupported TMDB ids while the manifest is still
  // pending. The mocked HTTP boundary separately paces each /stream/ request to two/second.
  expect(await fetchManifest(ADDON), 'The configured Stremio addon manifest did not load').not.toBeNull()
  return mapConcurrent(titles, 6, async (entry) => {
    const ids = streamIds(entry)
    if (!ids.length) return {
      ...entry, ids, streams: [], rawRows: 0, elapsedMs: 0, zeroReason: 'no-mapping',
    }
    const started = performance.now()
    const result = await fetchAddonStreams(ADDON, ids, entry.kind === 'movie' ? 'movie' : 'series')
    return {
      ...entry,
      ids,
      streams: rankStreams(normalizeCandidates(result.streams)),
      rawRows: result.total,
      elapsedMs: Math.round(performance.now() - started),
      zeroReason: result.streams.length ? undefined : 'addon-empty',
    }
  })
}

function hardKey(stream: Stream): string {
  const info = describeStream(stream)
  return [info.cached, info.quality, languageMismatch(info, 'jpn'), -1].join('|')
}

function observed(stable: boolean): SourceOutcomeSummary {
  const counts: SourceOutcomeCounts = {
    attempts: 12,
    startupSuccesses: stable ? 12 : 0,
    startupFailures: stable ? 0 : 12,
    stableSuccesses: stable ? 12 : 0,
    playbackFailures: 0,
    cancellations: 0,
    failureClasses: stable ? {} : { stalled: 12 },
    resolveSamples: 0,
    firstFrameSamples: stable ? 12 : 0,
    firstFrameMs: stable ? 2_500 : undefined,
  }
  return {
    context: { family: 'addon', sourceId: 'bulk-live', transport: 'direct-p2p' },
    automatic: counts,
    manual: {
      attempts: 0, startupSuccesses: 0, startupFailures: 0, stableSuccesses: 0,
      playbackFailures: 0, cancellations: 0, failureClasses: {}, resolveSamples: 0, firstFrameSamples: 0,
    },
    evidenceAt: Date.now(),
    lastAt: Date.now(),
  }
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function sliceKey(entry: Pick<EvaluationTitle, 'source' | 'kind'>): string {
  return `${entry.source}-${entry.kind}`
}

async function checkTorBox(results: EvaluatedTitle[]) {
  expect(TORBOX_KEY, 'The 500-title evaluation requires the configured TorBox key').not.toBe('')
  const selectedHashes = new Map<string, string>()
  for (const result of results) {
    const perTitle = [...new Set(result.streams.flatMap((stream) =>
      /^[a-f\d]{40}$/i.test(stream.infoHash ?? '') ? [stream.infoHash!.toLowerCase()] : []))].slice(0, 2)
    for (const hash of perTitle) selectedHashes.set(hash, sliceKey(result))
  }

  const states = new Map<string, 'cached' | 'uncached'>()
  const hashes = [...selectedHashes.keys()]
  for (let offset = 0; offset < hashes.length; offset += 100) {
    const chunk = hashes.slice(offset, offset + 100)
    const answer = await torbox.checkCached!(TORBOX_KEY, chunk)
    expect(answer.size, `TorBox omitted a cache answer for batch ${offset / 100 + 1}`).toBe(chunk.length)
    for (const [hash, state] of answer) states.set(hash, state)
    if (offset + 100 < hashes.length) await sleep(150)
  }

  const account = await torbox.listItems!(TORBOX_KEY)
  const ready = account.filter((item) => item.status === 'ready' && item.hash)
  const datasetHashes = new Set(hashes)
  const ordered = [
    ...ready.filter((item) => datasetHashes.has(item.hash!.toLowerCase())),
    ...ready.filter((item) => !datasetHashes.has(item.hash!.toLowerCase())),
  ]
  let byteProbes = 0
  let datasetByteProbes = 0
  let probeAttempts = 0
  for (const item of ordered.slice(0, 15)) {
    if (byteProbes >= 5) break
    probeAttempts++
    try {
      const files = await torbox.listFiles!(TORBOX_KEY, item)
      const file = files.find((candidate) => candidate.playable)
      if (!file || !item.hash) continue
      const url = await torbox.resolveHash(TORBOX_KEY, item.hash, {
        noAdd: true,
        priority: true,
        timeoutMs: 30_000,
        want: { filename: file.name },
      })
      const response = await fetch(url, {
        headers: { Range: 'bytes=0-65535' },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status !== 200 && response.status !== 206) continue
      const reader = response.body?.getReader()
      const first = await reader?.read()
      await reader?.cancel()
      if ((first?.value?.byteLength ?? 0) <= 0) continue
      byteProbes++
      if (datasetHashes.has(item.hash.toLowerCase())) datasetByteProbes++
    } catch { /* Continue through ready account entries; aggregate success is asserted below. */ }
  }
  expect(byteProbes, `Only ${byteProbes} of ${probeAttempts} bounded TorBox byte probes succeeded`).toBeGreaterThanOrEqual(3)

  return {
    checkedHashes: hashes.length,
    answeredHashes: states.size,
    cached: [...states.values()].filter((state) => state === 'cached').length,
    uncached: [...states.values()].filter((state) => state === 'uncached').length,
    accountItems: account.length,
    readyItems: ready.length,
    byteProbes,
    datasetByteProbes,
  }
}

live('500-title adaptive source evaluation', () => {
  it('validates catalog mapping, addon ingestion, planning safety, recovery, privacy, and TorBox delivery', async () => {
    const { titles, tmdbMode } = await buildCorpus()
    const counts = Object.fromEntries(['anilist-series', 'anilist-movie', 'tmdb-series', 'tmdb-movie']
      .map((key) => [key, titles.filter((title) => sliceKey(title) === key).length]))
    expect(titles).toHaveLength(500)
    expect(counts).toEqual({
      'anilist-series': 125,
      'anilist-movie': 125,
      'tmdb-series': 125,
      'tmdb-movie': 125,
    })
    expect(new Set(titles.map((entry) => `${entry.source}:${entry.kind}:${entry.catalogId}`)).size).toBe(500)
    const aniTmdb = new Set(titles.filter((entry) => entry.source === 'anilist').flatMap((entry) => entry.tmdb ? [entry.tmdb] : []))
    expect(titles.filter((entry) => entry.source === 'tmdb' && aniTmdb.has(entry.tmdb ?? ''))).toHaveLength(0)
    for (const source of ['anilist', 'tmdb'] as const) {
      for (const kind of ['series', 'movie'] as const) {
        for (const era of ERAS) {
          expect(titles.filter((entry) => entry.source === source && entry.kind === kind && entry.era === era.id)).toHaveLength(25)
        }
      }
    }

    const results = await evaluateSources(titles)
    const withStreams = results.filter((result) => result.streams.length)
    const allStreams = results.flatMap((result) => result.streams)
    const invalid = allStreams.filter((stream) =>
      !stream.url && !stream.externalUrl && !stream.ytId && !/^[a-f\d]{40}$/i.test(stream.infoHash ?? ''))
    expect(invalid).toHaveLength(0)
    expect(allStreams.every((stream) => !!stream.__candidate)).toBe(true)
    for (const result of withStreams) {
      expect(result.streams.every((stream) =>
        !stream.__evidence?.requestId || result.ids.includes(stream.__evidence.requestId))).toBe(true)
    }

    const coverage = Object.fromEntries(Object.keys(counts).map((key) => [
      key,
      results.filter((result) => sliceKey(result) === key && result.streams.length).length,
    ]))
    console.info(`[source-500-progress] ${JSON.stringify({
      withStreams: withStreams.length,
      coverage,
      streamStatuses: Object.fromEntries([...network.streamStatuses].sort(([left], [right]) => left - right)),
      noMapping: results.filter((result) => result.zeroReason === 'no-mapping').length,
      addonEmpty: results.filter((result) => result.zeroReason === 'addon-empty').length,
    })}`)
    expect(network.streamStatuses.get(429) ?? 0, 'The add-on rate-limited the corpus; coverage would be biased').toBe(0)
    expect(withStreams.length, 'Fewer than 40% of the stratified corpus returned a usable source').toBeGreaterThanOrEqual(200)
    for (const [key, count] of Object.entries(coverage)) {
      expect(count, `${key} returned usable sources for fewer than 20% of its corpus`).toBeGreaterThanOrEqual(25)
    }

    let privacyLeaks = 0
    let collapsedP2pProfiles = 0
    let syntheticEligible = 0
    let syntheticChanged = 0
    let recoveryCases = 0
    for (const result of withStreams) {
      const baseline = result.streams
      const noEvidence = planSources(baseline, { directP2p: true, audioLang: 'jpn' })
      expect(noEvidence.planned).toEqual(baseline)
      expect(noEvidence.changed).toBe(false)

      const contexts = baseline.map((stream) => sourceOutcomeContext(stream, 'direct-p2p'))
      const serialized = JSON.stringify(contexts)
      for (const stream of baseline) {
        if (stream.infoHash && serialized.includes(stream.infoHash.toLowerCase())) privacyLeaks++
      }
      const hashes = new Set(baseline.flatMap((stream) => stream.infoHash ? [stream.infoHash.toLowerCase()] : []))
      const profiles = new Set(contexts.map((context) => context.profileId).filter(Boolean))
      if (hashes.size >= 2 && profiles.size <= 1) collapsedP2pProfiles++

      const buckets = new Map<string, Stream[]>()
      for (const stream of baseline) buckets.set(hardKey(stream), [...(buckets.get(hardKey(stream)) ?? []), stream])
      const pair = [...buckets.values()].find((bucket) => bucket.length >= 2)
      if (pair) {
        syntheticEligible++
        const summaries = new Map<Stream, SourceOutcomeSummary>([[pair[0], observed(false)], [pair[1], observed(true)]])
        const outcomeOf = (stream: Stream, _transport: PlaybackTransport) => summaries.get(stream)
        const plan = planSources(baseline, { directP2p: true, audioLang: 'jpn', outcomeOf })
        expect(plan.planned).toHaveLength(baseline.length)
        expect(new Set(plan.planned)).toEqual(new Set(baseline))
        plan.planned.forEach((stream, index) => expect(hardKey(stream)).toBe(hardKey(baseline[index])))
        for (const bucket of buckets.values()) {
          const after = plan.planned.filter((stream) => hardKey(stream) === hardKey(bucket[0]))
          for (const stream of bucket) {
            expect(Math.abs(after.indexOf(stream) - bucket.indexOf(stream))).toBeLessThanOrEqual(2)
          }
        }
        if (plan.changed) syntheticChanged++
      }

      const [failed, ...remaining] = baseline
      if (failed && remaining.length) {
        recoveryCases++
        const failedRelease = failed.__candidate?.releaseId ?? candidateIds(failed).releaseId
        const recovery = planRecoveryCandidates(remaining, failed, 'wrong-content', {
          directP2p: true, audioLang: 'jpn',
        })
        expect(recovery.every((stream) => (stream.__candidate?.releaseId ?? candidateIds(stream).releaseId) !== failedRelease)).toBe(true)
      }
    }
    expect(privacyLeaks).toBe(0)
    expect(syntheticEligible, 'The live corpus had too few equivalent choices to exercise adaptation').toBeGreaterThanOrEqual(25)
    expect(syntheticChanged).toBe(syntheticEligible)
    expect(recoveryCases).toBeGreaterThanOrEqual(100)

    const torboxReport = await checkTorBox(results)
    const zeroReasons = Object.fromEntries(['no-mapping', 'addon-empty'].map((reason) => [
      reason,
      results.filter((result) => result.zeroReason === reason).length,
    ]))
    const eraCoverage = Object.fromEntries(ERAS.map((era) => [
      era.id,
      results.filter((result) => result.era === era.id && result.streams.length).length,
    ]))
    const report = {
      corpus: { total: titles.length, slices: counts, tmdbMode },
      mappings: {
        anilistKitsu: titles.filter((entry) => entry.source === 'anilist' && entry.kitsu != null).length,
        anilistImdb: titles.filter((entry) => entry.source === 'anilist' && !!entry.imdb).length,
        tmdbImdb: titles.filter((entry) => entry.source === 'tmdb' && !!entry.imdb).length,
      },
      addon: {
        titlesWithStreams: withStreams.length,
        titleCoverage: coverage,
        eraCoverage,
        zeroReasons,
        usableRows: allStreams.length,
        uniqueHashes: new Set(allStreams.flatMap((stream) => stream.infoHash ? [stream.infoHash.toLowerCase()] : [])).size,
        medianMs: percentile(results.map((result) => result.elapsedMs), 0.5),
        p95Ms: percentile(results.map((result) => result.elapsedMs), 0.95),
      },
      planner: {
        activeNoEvidenceUnchanged: withStreams.length,
        syntheticEligible,
        syntheticChanged,
        recoveryCases,
        privacyLeaks,
        collapsedP2pProfiles,
      },
      torbox: torboxReport,
      http: {
        statuses: Object.fromEntries([...network.statuses].sort(([left], [right]) => left - right)),
        requestCount: [...network.requests.values()].reduce((sum, count) => sum + count, 0),
      },
    }
    console.info(`[source-500-live] ${JSON.stringify(report)}`)
  }, 20 * 60_000)
})
