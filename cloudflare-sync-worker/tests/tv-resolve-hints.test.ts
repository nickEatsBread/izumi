import { beforeEach, expect, it, vi } from 'vitest'
const adapters = vi.hoisted(() => ({ resolve: vi.fn(), sidecars: vi.fn() }))
vi.mock('../src/generated/resolver-core/debrid/index.ts', async importOriginal => ({
  ...await importOriginal<object>(), resolveHash: adapters.resolve, resolveSidecars: adapters.sidecars, cacheCheckMode: () => 'none',
}))
import { providers } from '../src/generated/resolver-core/debrid/index.ts'
import { normalizeResolveRequest, resolveDirectSources } from '../src/resolver.js'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const HASH = '161c22aecdc3ed95fb629c275ee23f77ca601f3c'
const movie = { ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }
const provider = providers.keys().next().value
const withDebrid = { enabled: true, addons: ['https://source.example'], debrid: { provider, credential: 'private-key' } }
const listing = (streams: unknown[], manifest: Record<string, unknown> = {}) => async (url: string) =>
  json(url.endsWith('/manifest.json') ? { resources: ['stream'], ...manifest } : { streams })

beforeEach(() => { adapters.resolve.mockReset(); adapters.sidecars.mockReset().mockResolvedValue([]) })

it('accepts bounded release-year and runtime hints and ignores nonsense', () => {
  expect(normalizeResolveRequest({ ...movie, year: 2026, runtimeMinutes: 148 })).toMatchObject({ year: 2026, runtimeMinutes: 148 })
  const nonsense = normalizeResolveRequest({ ...movie, year: 12, runtimeMinutes: -5 })
  expect(nonsense).not.toHaveProperty('year')
  expect(nonsense).not.toHaveProperty('runtimeMinutes')
  expect(normalizeResolveRequest({ ...movie, year: '2026' })).toMatchObject({ year: 2026 })
})

it('uses the TV release year to reject a same-title production from another decade', async () => {
  const fetcher = listing([
    { title: 'Example Film 1997 1080p', url: 'https://media.example/old.mkv', behaviorHints: { filename: 'Example.Film.1997.1080p.BluRay.mkv' } },
    { title: 'Example Film 2026 1080p', url: 'https://media.example/new.mkv', behaviorHints: { filename: 'Example.Film.2026.1080p.WEB-DL.mkv' } },
  ])
  const unhinted = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie, fetcher)
  expect(unhinted.candidates).toHaveLength(2)
  const hinted = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, { ...movie, year: 2026 }, fetcher)
  expect(hinted.candidates.map(candidate => candidate.url)).toEqual(['https://media.example/new.mkv'])
  expect(hinted.rejected).toBe(1)
})

it('prepares a gateway playback route through the owner provider instead of handing the route to the TV', async () => {
  adapters.resolve.mockResolvedValue('https://provider.example/prepared.mkv')
  const route = `https://gateway.example/cfg-token/playback/${HASH}/0/Example.Film.2026.1080p.mkv`
  const result = await resolveDirectSources(withDebrid, movie,
    listing([{ name: 'Gateway', title: 'Example Film 2026 1080p', url: route, behaviorHints: { filename: 'Example.Film.2026.1080p.mkv' } }]))
  expect(adapters.resolve).toHaveBeenCalledTimes(1)
  expect(String(adapters.resolve.mock.calls[0][2])).toContain(HASH)
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0]).toMatchObject({ url: 'https://provider.example/prepared.mkv', delivery: 'debrid' })
  expect(JSON.stringify(result)).not.toContain('cfg-token')
})

it('keeps the gateway route as a trailing fallback when the provider cannot prepare it', async () => {
  adapters.resolve.mockImplementation(async (_provider, _key, magnet: string) => {
    if (magnet.includes(HASH)) throw new Error('Release unavailable')
    return `https://provider.example/${magnet.slice(-40)}.mkv`
  })
  const route = `https://gateway.example/cfg-token/playback/${HASH}/0/Example.Film.2026.2160p.mkv`
  const result = await resolveDirectSources(withDebrid, movie, listing([
    { name: 'Gateway', title: 'Example Film 2026 2160p', url: route, behaviorHints: { filename: 'Example.Film.2026.2160p.mkv' } },
    { title: 'Example Film 2026 1080p', infoHash: 'b'.repeat(40), behaviorHints: { filename: 'Example.Film.2026.1080p.mkv' } },
  ]))
  expect(result.candidates.map(candidate => candidate.delivery)).toEqual(['debrid', 'hosted'])
  expect(result.candidates[1]).toMatchObject({ url: route, hosted: true })
})

it('marks a gateway route as hosted when no provider is configured to replace it', async () => {
  const route = `https://gateway.example/cfg-token/playback/${HASH}/0/Example.Film.mkv`
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'] }, movie,
    listing([{ title: 'Example Film 1080p', url: route }, { title: 'Example Film 720p', url: 'https://media.example/plain.mkv' }]))
  expect(result.candidates.find(candidate => candidate.url === route)).toMatchObject({ hosted: true, delivery: 'hosted' })
  expect(result.candidates.find(candidate => candidate.url === 'https://media.example/plain.mkv')).toMatchObject({ delivery: 'direct' })
  expect(result.candidates.find(candidate => candidate.url === 'https://media.example/plain.mkv')).not.toHaveProperty('hosted')
})

it('describes each candidate with its listing source, logo and release facts for the TV picker', async () => {
  adapters.resolve.mockResolvedValue('https://provider.example/prepared.mkv')
  const result = await resolveDirectSources(withDebrid, movie, listing([
    { title: 'Example Film 1080p\n👤 120 💾 4.2 GB', url: 'https://media.example/plain.mkv', behaviorHints: { filename: 'Example.Film.2026.1080p.WEB-DL-GROUP.mkv' } },
    { title: 'Example Film 2160p\n👤 8 💾 12 GB', infoHash: 'c'.repeat(40), behaviorHints: { filename: 'Example.Film.2026.2160p.mkv' } },
  ], { name: 'Source A', logo: 'https://source.example/logo.png' }))
  const direct = result.candidates.find(candidate => candidate.url === 'https://media.example/plain.mkv')
  expect(direct).toMatchObject({ origin: { name: 'Source A', logo: 'https://source.example/logo.png' }, size: '4.2 GB', seeders: 120, group: 'GROUP' })
  const prepared = result.candidates.find(candidate => candidate.delivery === 'debrid')
  expect(prepared).toMatchObject({ origin: { name: 'Source A', logo: 'https://source.example/logo.png' }, seeders: 8 })
})
