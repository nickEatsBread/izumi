import { expect, it, vi } from 'vitest'
import { resolveDirectSources } from '../src/resolver.js'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const movie = { ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }
const listing = (streams: unknown[]) => async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams })
const streams = [
  { title: 'Example Film 2026 720p\n💾 8.2 GB', url: 'https://media.example/big-720.mkv', behaviorHints: { filename: 'Example.Film.2026.720p.mkv', videoSize: 8_200_000_000 } },
  { title: 'Example Film 2026 1080p\n💾 2.1 GB', url: 'https://media.example/small-1080.mkv', behaviorHints: { filename: 'Example.Film.2026.1080p.mkv', videoSize: 2_100_000_000 } },
]

it('lists sources in the synced picker order while auto-play keeps the quality pick', async () => {
  const bySize = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], sort: 'size' }, movie, listing(streams))
  expect(bySize.candidates.map(candidate => candidate.url)).toEqual(['https://media.example/big-720.mkv', 'https://media.example/small-1080.mkv'])
  expect(bySize.candidates.find(candidate => candidate.id === bySize.selectedId)?.url).toBe('https://media.example/small-1080.mkv')
  const byQuality = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], sort: 'quality' }, movie, listing(streams))
  expect(byQuality.candidates.map(candidate => candidate.url)).toEqual(['https://media.example/small-1080.mkv', 'https://media.example/big-720.mkv'])
  expect(byQuality.selectedId).toBe(byQuality.candidates[0].id)
})

it('publishes progress in picker order with the auto-pick identified separately', async () => {
  const onProgress = vi.fn()
  const result = await resolveDirectSources({ enabled: true, addons: ['https://source.example'], sort: 'size' }, movie, listing(streams), { onProgress })
  const last = onProgress.mock.calls.at(-1)?.[0]
  expect(last.candidates.map((candidate: any) => candidate.url)).toEqual(['https://media.example/big-720.mkv', 'https://media.example/small-1080.mkv'])
  expect(last.selectedId).toBe(result.selectedId)
  expect(last.candidates.find((candidate: any) => candidate.id === last.selectedId)?.url).toBe('https://media.example/small-1080.mkv')
})
