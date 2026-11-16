import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
const records = [
  { deviceId: 'peer', hash: 'peer-1', payload: JSON.stringify({ app: 'izumi', kind: 'watch-history', version: 1 }) },
  { deviceId: 'me', hash: 'me-1', payload: JSON.stringify({ app: 'izumi', kind: 'watch-history', version: 1 }) },
]
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === 'sync_status') return { state: 'ready', paired: true, endpointId: 'me' }
    if (cmd === 'sync_read') return args.category === 'watch' ? records.filter((r) => !(args.skip as string[]).includes(r.hash)) : []
    if (cmd === 'sync_write') return `${String(args.category)}-written`
    return undefined
  }),
}))
vi.mock('$lib/storage/library-db', async (importOriginal) => ({ ...await importOriginal<typeof import('$lib/storage/library-db')>(), libraryStorageReady: async () => {}, flushLibraryStorage: async () => {} }))
const importJson = vi.fn(() => ({ imported: 0, positionsImported: 0, originsImported: 0, episodeOriginsImported: 0, sceneBookmarksImported: 0 }))
vi.mock('$lib/player/history-io', () => ({ importJson, exportWatchBundle: () => ({ app: 'izumi', kind: 'watch-history', version: 1 }) }))

const { pullWatchProgress, pushWatchProgress } = await import('./client')
const reads = () => calls.filter((c) => c.cmd === 'sync_read' && c.args.category === 'watch').map((c) => c.args.skip)

describe('device sync merges each watch record once', () => {
  beforeEach(() => { calls.length = 0 })

  it('leaves out the records it has already merged, and its own last write', async () => {
    await pullWatchProgress()
    expect(importJson).toHaveBeenCalledTimes(2)
    await pullWatchProgress()
    expect(importJson).toHaveBeenCalledTimes(2)
    expect(reads()).toEqual([[], ['peer-1', 'me-1']])

    await pushWatchProgress()
    calls.length = 0
    await pullWatchProgress()
    expect(reads()).toEqual([['peer-1', 'watch-written']])
  })
})
