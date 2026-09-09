import { expect, it } from 'vitest'
import { resolveDirectSources } from '../src/resolver.js'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const movie = { ref: { provider: 'tmdb', type: 'movie', id: '123' }, streamType: 'movie', streamIds: ['tt0123456'], title: 'Example Film' }
const listing = (streams: unknown[]) => async (url: string) => json(url.endsWith('/manifest.json') ? { resources: ['stream'] } : { streams })
const streams = [
  { title: 'Example Film 2026 1080p WEBRip\n👤 100 💾 1.6 GB', url: 'https://media.example/thin.mp4', behaviorHints: { filename: 'Example.Film.2026.1080p.WEBRip.x264.mp4', videoSize: 1_600_000_000 } },
  { title: 'Example Film 2026 1080p WEB-DL\n👤 70 💾 4.3 GB', url: 'https://media.example/full.mkv', behaviorHints: { filename: 'Example.Film.2026.1080p.WEB-DL.x264.mkv', videoSize: 4_300_000_000 } },
  { title: 'Пример / Example Film [2026, ProRes encode] Трейлер #2 (4K/IMAX4K)\n👤 122 💾 2.38 GB', url: 'https://media.example/promo.mkv' },
  { title: 'Example Film 2026 1080p WEBRip\n👤 32767 💾 1.6 GB', url: 'https://media.example/placeholder.mp4', behaviorHints: { filename: 'Example.Film.2026.1080p.WEBRip.x264-OTHER.mp4', videoSize: 1_600_000_000 } },
]

it('uses the TV runtime hint to rank a credible encode above thin re-encodes and drops a foreign-language trailer', async () => {
  const profile = { enabled: true, addons: ['https://source.example'] }
  const unhinted = await resolveDirectSources(profile, movie, listing(streams))
  expect(unhinted.candidates.map(candidate => candidate.url)).not.toContain('https://media.example/promo.mkv')
  const hinted = await resolveDirectSources(profile, { ...movie, year: 2026, runtimeMinutes: 150 }, listing(streams))
  expect(hinted.candidates[0].url).toBe('https://media.example/full.mkv')
  expect(hinted.selectedId).toBe(hinted.candidates[0].id)
  expect(hinted.candidates.find(candidate => candidate.url === 'https://media.example/placeholder.mp4')).not.toHaveProperty('seeders')
})
