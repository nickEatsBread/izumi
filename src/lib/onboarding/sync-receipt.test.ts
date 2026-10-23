import { describe, expect, it } from 'vitest'
import { plannedSyncTasks, serialDrain, sourcesLanded, syncFailures, syncSettled, syncSucceededAny, tasksFor, type SyncTask, type SyncTaskId } from './sync-receipt'

const noExtras = { library: false, progress: false, history: false }

describe('planned sync tasks', () => {
  it('plans nothing when nothing connected', () => {
    expect(plannedSyncTasks([], noExtras)).toEqual([])
  })

  it('plans one task per connected tracker', () => {
    expect(plannedSyncTasks(['anilist', 'mal'], noExtras)).toEqual(['anilist', 'mal'])
  })

  it('always brings Nuvio sources and collections, and only the extras that were ticked', () => {
    expect(plannedSyncTasks(['nuvio'], noExtras)).toEqual(['nuvio-sources', 'nuvio-collections'])
    expect(plannedSyncTasks(['nuvio'], { library: true, progress: false, history: true }))
      .toEqual(['nuvio-sources', 'nuvio-collections', 'nuvio-library', 'nuvio-history'])
  })

  it('ignores Nuvio extras when Nuvio was not connected', () => {
    expect(plannedSyncTasks(['stremio'], { library: true, progress: true, history: true })).toEqual(['stremio'])
  })

  it('runs sources before lists so the sources screen has something to review', () => {
    expect(plannedSyncTasks(['mal', 'nuvio', 'stremio'], noExtras))
      .toEqual(['stremio', 'nuvio-sources', 'nuvio-collections', 'mal'])
  })
})

describe('sync receipt', () => {
  const task = (id: SyncTask['id'], state: SyncTask['state']): SyncTask => ({ id, state })

  it('is not settled while any task is pending or running', () => {
    expect(syncSettled([task('stremio', { status: 'running' })])).toBe(false)
    expect(syncSettled([task('stremio', { status: 'pending' })])).toBe(false)
  })

  it('is settled once every task has finished either way', () => {
    expect(syncSettled([
      task('stremio', { status: 'done', detail: '7 add-ons' }),
      task('mal', { status: 'failed', message: 'offline' }),
    ])).toBe(true)
  })

  it('separates a total failure from a partial one', () => {
    const partial = [task('stremio', { status: 'done', detail: '7 add-ons' }), task('mal', { status: 'failed', message: 'offline' })]
    const total = [task('mal', { status: 'failed', message: 'offline' })]
    expect(syncSucceededAny(partial)).toBe(true)
    expect(syncSucceededAny(total)).toBe(false)
    expect(syncFailures(partial).map((entry) => entry.id)).toEqual(['mal'])
    expect(syncFailures(total)).toHaveLength(1)
  })

  it('counts only source-producing tasks as sources landing', () => {
    expect(sourcesLanded([task('stremio', { status: 'done', detail: '7 sources' })])).toBe(true)
    expect(sourcesLanded([task('nuvio-sources', { status: 'done', detail: '3 sources' })])).toBe(true)
  })

  it('does not treat collections or a tracker as a source', () => {
    expect(sourcesLanded([
      task('nuvio-collections', { status: 'done', detail: '4 collections' }),
      task('mal', { status: 'done', detail: 'alex' }),
    ])).toBe(false)
  })

  it('does not count a source task that failed or is still running', () => {
    expect(sourcesLanded([task('stremio', { status: 'failed', message: 'offline' })])).toBe(false)
    expect(sourcesLanded([task('nuvio-sources', { status: 'running' })])).toBe(false)
  })
})

describe('tasks for one service', () => {
  const all: SyncTask[] = (['stremio', 'nuvio-sources', 'nuvio-library', 'anilist', 'mal'] as const)
    .map((id): SyncTask => ({ id, state: { status: 'pending' } }))

  it('gives each connect tile only its own imports', () => {
    expect(tasksFor(all, 'stremio').map((task) => task.id)).toEqual(['stremio'])
    expect(tasksFor(all, 'nuvio').map((task) => task.id)).toEqual(['nuvio-sources', 'nuvio-library'])
    expect(tasksFor(all, 'mal').map((task) => task.id)).toEqual(['mal'])
  })
})

describe('serial drain', () => {
  function harness(initial: SyncTaskId[]) {
    const queue = [...initial]
    const ran: SyncTaskId[] = []
    let active = 0
    let peak = 0
    const release: Array<() => void> = []
    const run = async (id: SyncTaskId) => {
      active += 1
      peak = Math.max(peak, active)
      ran.push(id)
      await new Promise<void>((resolve) => release.push(resolve))
      active -= 1
    }
    const next = () => queue.shift()
    return { queue, ran, run, next, peak: () => peak, release }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('runs queued tasks in order, never two at once, and picks up tasks queued mid-run', async () => {
    const h = harness(['stremio', 'nuvio-sources'])
    const drain = serialDrain(h.next, h.run, new AbortController().signal)
    const done = drain()
    await settle()
    h.queue.push('nuvio-collections')
    while (h.release.length) { h.release.shift()!(); await settle() }
    await done
    expect(h.ran).toEqual(['stremio', 'nuvio-sources', 'nuvio-collections'])
    expect(h.peak()).toBe(1)
  })

  it('joins the running loop instead of starting a second one', async () => {
    const h = harness(['stremio'])
    const drain = serialDrain(h.next, h.run, new AbortController().signal)
    const first = drain()
    await settle()
    h.queue.push('nuvio-sources')
    await drain() // returns at once: a loop is already running
    while (h.release.length) { h.release.shift()!(); await settle() }
    await first
    expect(h.ran).toEqual(['stremio', 'nuvio-sources'])
    expect(h.peak()).toBe(1)
  })

  it('stops picking up tasks once aborted', async () => {
    const h = harness(['stremio', 'nuvio-sources'])
    const abort = new AbortController()
    const done = serialDrain(h.next, h.run, abort.signal)()
    await settle()
    abort.abort()
    h.release.shift()!()
    await done
    expect(h.ran).toEqual(['stremio'])
  })

  it('starts a fresh run when called again after going idle', async () => {
    const h = harness(['stremio'])
    const drain = serialDrain(h.next, h.run, new AbortController().signal)
    const first = drain()
    await settle()
    h.release.shift()!()
    await first
    h.queue.push('nuvio-sources')
    const second = drain()
    await settle()
    h.release.shift()!()
    await second
    expect(h.ran).toEqual(['stremio', 'nuvio-sources'])
  })
})
