import type { ConnectService } from './connect-state'

export type SyncTaskId =
  | 'stremio'
  | 'nuvio-sources'
  | 'nuvio-collections'
  | 'nuvio-library'
  | 'nuvio-progress'
  | 'nuvio-history'

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
  return tasks
}

/** The tasks that can actually put a playable source in the user's list. Collections are home-screen
 *  furniture, not sources, so they do not count. */
const SOURCE_TASKS: readonly SyncTaskId[] = ['stremio', 'nuvio-sources']

/** Whether the next screen can show a review of real sources instead of an empty picker. */
export function sourcesLanded(tasks: readonly SyncTask[]): boolean {
  return tasks.some((task) => SOURCE_TASKS.includes(task.id) && task.state.status === 'done')
}

/** The tasks a service owns, so its sign-in tile can show its own import result. */
export function tasksFor(tasks: readonly SyncTask[], service: ConnectService): SyncTask[] {
  return tasks.filter((task) => task.id === service || task.id.startsWith(`${service}-`))
}

/**
 * Runs pending tasks one at a time. Calling the returned function while a run is in progress
 * joins it: the running loop picks up anything queued meanwhile, so two writers never overlap.
 */
export function serialDrain(next: () => SyncTaskId | undefined, run: (id: SyncTaskId) => Promise<void>, signal: AbortSignal): () => Promise<void> {
  let draining = false
  return async () => {
    if (draining) return
    draining = true
    try {
      for (let id = next(); id && !signal.aborted; id = next()) await run(id)
    } finally {
      draining = false
    }
  }
}
