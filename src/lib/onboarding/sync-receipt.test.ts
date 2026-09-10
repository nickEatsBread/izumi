import { describe, expect, it } from 'vitest'
import { plannedSyncTasks, syncFailures, syncSettled, syncSucceededAny, type SyncTask } from './sync-receipt'

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
})
