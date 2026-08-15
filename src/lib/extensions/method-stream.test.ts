import { describe, expect, it } from 'vitest'
import { settleExtensionMethods } from './method-stream'

describe('extension method streaming', () => {
  it('releases a fast single result without waiting for a slow batch', async () => {
    let finishBatch!: (rows: string[]) => void
    const batch = new Promise<string[]>((resolve) => { finishBatch = resolve })
    const seen: string[] = []

    const all = settleExtensionMethods(
      ['single', 'batch'] as const,
      (method) => method === 'single' ? Promise.resolve(['episode']) : batch,
      (method, rows) => seen.push(`${method}:${rows.join(',')}`),
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual(['single:episode'])

    finishBatch(['season pack'])
    await expect(all).resolves.toEqual([
      { method: 'single', result: ['episode'] },
      { method: 'batch', result: ['season pack'] },
    ])
    expect(seen).toEqual(['single:episode', 'batch:season pack'])
  })
})
