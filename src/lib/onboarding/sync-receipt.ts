import type { ConnectService } from './connect-state'

export type SyncTaskId =
  | 'stremio'
  | 'nuvio-sources'
  | 'nuvio-collections'
  | 'nuvio-library'
  | 'nuvio-progress'
  | 'nuvio-history'
  | 'anilist'
  | 'mal'

export type SyncTaskState =
  | { status: 'pending' }
  | { status: 'running' }
  | { status: 'done'; detail: string }
  | { status: 'failed'; message: string }

export interface SyncTask {
  id: SyncTaskId
  state: SyncTaskState
}

export interface NuvioExtras {
  library: boolean
  progress: boolean
  history: boolean
}

/** Sources first: the sources screen is next, and it shows a review face only if something landed. */
export function plannedSyncTasks(services: readonly ConnectService[], extras: NuvioExtras): SyncTaskId[] {
  const tasks: SyncTaskId[] = []
  if (services.includes('stremio')) tasks.push('stremio')
  if (services.includes('nuvio')) {
    tasks.push('nuvio-sources', 'nuvio-collections')
    if (extras.library) tasks.push('nuvio-library')
    if (extras.progress) tasks.push('nuvio-progress')
    if (extras.history) tasks.push('nuvio-history')
  }
  if (services.includes('anilist')) tasks.push('anilist')
  if (services.includes('mal')) tasks.push('mal')
  return tasks
}

export function syncSettled(tasks: readonly SyncTask[]): boolean {
  return tasks.every((task) => task.state.status === 'done' || task.state.status === 'failed')
}

export function syncSucceededAny(tasks: readonly SyncTask[]): boolean {
  return tasks.some((task) => task.state.status === 'done')
}

export function syncFailures(tasks: readonly SyncTask[]): SyncTask[] {
  return tasks.filter((task) => task.state.status === 'failed')
}
