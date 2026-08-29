import { describe, expect, it } from 'vitest'
import {
  decodeStremioIdentity,
  encodeStremioIdentity,
  stremioMetaMatchesIdentity,
  stremioMetaUrl,
} from './stremio'

const enabled = process.env.IZUMI_LIVE_STREMIO_META_500_TEST === '1'
const live = describe.skipIf(!enabled)
const BASE = process.env.IZUMI_LIVE_STREMIO_META_ADDON?.trim() || 'https://v3-cinemeta.strem.io'

interface Meta {
  id?: string
  type?: string
  name?: string
  year?: number | string
  releaseInfo?: string
  released?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.ok) return await response.json() as T
      last = new Error(`${new URL(url).hostname} returned HTTP ${response.status}`)
      if (response.status !== 429 && response.status < 500) break
    } catch (error) { last = error }
    if (attempt + 1 < attempts) await sleep(500 * 2 ** attempt)
  }
  throw last instanceof Error ? last : new Error('Request failed')
}

async function mapConcurrent<T, R>(values: readonly T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      output[index] = await fn(values[index])
    }
  }))
  return output
}

function evenly<T>(values: readonly T[], count: number): T[] {
  if (values.length < count) throw new Error(`Needed ${count} catalog records, received ${values.length}`)
  return Array.from({ length: count }, (_, index) =>
    values[Math.floor(index * (values.length - 1) / Math.max(1, count - 1))])
}

function year(meta: Meta): number | undefined {
  const match = String(meta.year ?? meta.releaseInfo ?? meta.released ?? '').match(/\b(?:18|19|20|21)\d{2}\b/)
  return match ? Number(match[0]) : undefined
}

async function catalog(type: 'movie' | 'series'): Promise<Meta[]> {
  const pages = await mapConcurrent(Array.from({ length: 12 }, (_, index) => index * 50), 4, async (skip) =>
    fetchJson<{ metas?: Meta[] }>(`${BASE}/catalog/${type}/top/skip=${skip}.json`))
  const unique = [...new Map(pages.flatMap((page) => page.metas ?? [])
    .filter((meta): meta is Meta & { id: string; name: string } => !!meta.id && !!meta.name)
    .map((meta) => [meta.id, meta])).values()]
  return evenly(unique, 250)
}

live('500-card Stremio metadata identity evaluation', () => {
  it('keeps 250 film and 250 series cards bound to their own detail response', async () => {
    const [movies, series] = await Promise.all([catalog('movie'), catalog('series')])
    expect(movies).toHaveLength(250)
    expect(series).toHaveLength(250)
    const cards = [
      ...movies.map((meta) => ({ type: 'movie' as const, meta })),
      ...series.map((meta) => ({ type: 'series' as const, meta })),
    ]
    expect(new Set(cards.map(({ type, meta }) => `${type}:${meta.id}`)).size).toBe(500)

    const checked = await mapConcurrent(cards, 8, async ({ type, meta: card }) => {
      const encoded = encodeStremioIdentity('cinemeta-live', type, card.id!)
      const decoded = decodeStremioIdentity(encoded)
      expect(decoded).not.toBeNull()
      const response = await fetchJson<{ meta?: Meta }>(stremioMetaUrl(BASE, decoded!.type, decoded!.id))
      const identity = {
        ...decoded!,
        expectedTitle: card.name,
        expectedYear: year(card),
      }
      return {
        type,
        id: card.id,
        title: card.name,
        detailTitle: response.meta?.name,
        matches: !!response.meta && stremioMetaMatchesIdentity(response.meta, identity),
      }
    })
    const mismatches = checked.filter((entry) => !entry.matches)
    expect(mismatches, JSON.stringify(mismatches.slice(0, 10))).toHaveLength(0)
    console.info(`[stremio-meta-500-live] ${JSON.stringify({
      checked: checked.length,
      movies: checked.filter((entry) => entry.type === 'movie').length,
      series: checked.filter((entry) => entry.type === 'series').length,
      mismatches: mismatches.length,
    })}`)
  }, 10 * 60_000)
})
