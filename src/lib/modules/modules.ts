/** Optional native modules (Rust `modules`): packs ask for them by id, the app downloads them in the
 *  background, and anything that needs one (the protected-video player) can wait for it here. */
import { invoke } from '@tauri-apps/api/core'
import { get, writable } from 'svelte/store'
import { listenSafe } from '$lib/util/listen'

export type ModuleState = 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'failed'

export interface ModuleProgress {
  id: string
  state: ModuleState
  received: number
  total: number
  version: string | null
  error: string | null
}

export interface ModuleStatus extends ModuleProgress {
  name: string
  purpose: string
  publisher: string
  approxBytes: number
  licence: string
  /** Whether this device uses the module at all. */
  needed: boolean
  wanted: boolean
  requestedBy: string[]
}

/** Every module this build knows, keyed by id. Empty until `initModules` has run. */
export const modules = writable<Record<string, ModuleStatus>>({})

function merge(progress: ModuleProgress) {
  modules.update((all) => {
    const known = all[progress.id]
    return known ? { ...all, [progress.id]: { ...known, ...progress } } : all
  })
}

let started = false

/** Loads module status and follows progress events. Safe to call more than once. */
export async function initModules(): Promise<void> {
  if (!started) {
    started = true
    listenSafe<ModuleProgress>('module-progress', ({ payload }) => merge(payload))
  }
  await refreshModules()
}

export async function refreshModules(): Promise<Record<string, ModuleStatus>> {
  try {
    const list = await invoke<ModuleStatus[]>('module_status')
    const next = Object.fromEntries(list.map((m) => [m.id, m]))
    modules.set(next)
    return next
  } catch {
    return get(modules)
  }
}

/** Asks for a module on behalf of `by` (`pack:<id>` or `user`). Call only after its licence was shown. */
export async function requestModule(id: string, by: string): Promise<ModuleStatus> {
  const status = await invoke<ModuleStatus>('module_request', { id, by })
  modules.update((all) => ({ ...all, [id]: status }))
  return status
}

export function retryModules(): Promise<void> {
  return invoke('module_retry')
}

/** Withdraws `by`'s request (null removes every request and the module itself). */
export async function releaseModule(id: string, by: string | null): Promise<void> {
  await invoke('module_release', { id, by })
  await refreshModules()
}

/** True when the module is wanted and needed here but not installed yet: it is on its way. */
export function moduleOnItsWay(status: ModuleStatus | undefined): boolean {
  return !!status && status.needed && status.wanted && status.state !== 'ready'
}

/** Resolves true once the module is ready, false if `signal` aborts first. */
export function waitForModule(id: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    if (get(modules)[id]?.state === 'ready') return resolve(true)
    const stop = modules.subscribe((all) => {
      if (all[id]?.state !== 'ready') return
      queueMicrotask(() => stop())
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    })
    function onAbort() {
      stop()
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** "12.3 of 21.0 MB" style progress text. */
export function moduleProgressText(m: Pick<ModuleProgress, 'state' | 'received' | 'total' | 'error'>): string {
  const mb = (n: number) => (n / 1_048_576).toFixed(1)
  switch (m.state) {
    case 'downloading':
      return m.total ? `${mb(m.received)} of ${mb(m.total)} MB` : 'Downloading…'
    case 'installing':
      return 'Installing…'
    case 'failed':
      return m.error ? `Download failed: ${m.error}` : 'Download failed'
    case 'ready':
      return 'Ready'
    default:
      return 'Starting download…'
  }
}

export function modulePercent(m: Pick<ModuleProgress, 'state' | 'received' | 'total'>): number {
  if (m.state === 'ready' || m.state === 'installing') return 100
  return m.total > 0 ? Math.min(100, Math.round((m.received / m.total) * 100)) : 0
}
