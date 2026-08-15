import { describe, expect, it } from 'vitest'
import { afterExtensionReady, settleExtensionMethods } from './method-stream'

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

  it('lets a ready provider answer while a sibling is still loading', async () => {
    let releaseSlow!: (ready: boolean) => void
    const slowReady = new Promise<boolean>((resolve) => { releaseSlow = resolve })
    const seen: string[] = []
    const fast = afterExtensionReady(Promise.resolve(true), async () => 'fast', 'unavailable')
    const slow = afterExtensionReady(slowReady, async () => 'slow', 'unavailable')

    const fastDone = fast().then((value) => seen.push(value))
    const slowDone = slow().then((value) => seen.push(value))
    await fastDone
    expect(seen).toEqual(['fast'])

    releaseSlow(true)
    await slowDone
    expect(seen).toEqual(['fast', 'slow'])
  })
})
