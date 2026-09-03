import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { addonUrls, disabledSources, normalizeBase } from './sources'
import { fetchManifest } from './manifest'
import {
  pullStremioAddons,
  pushStremioAddons,
  stremioAccountId,
  stremioAuthKey,
  type StremioAddonDescriptor,
} from './account'

interface SyncBaseline {
  accountId: string
  urls: string[]
}

export type StremioAddonSyncState =
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'synced'; count: number; pushed: boolean; at: number }
  | { state: 'error'; message: string }

export interface StremioAddonSyncResult {
  count: number
  pushed: boolean
}

export interface StremioAddonReconciliation {
  urls: string[]
  retainedDescriptors: StremioAddonDescriptor[]
  descriptorBasesToCreate: string[]
  needsPush: boolean
}

// Baselines contain configured add-on URLs, which may contain credentials. The storage key is
// intentionally classified as a credential so it is omitted from ordinary Izumi backups.
const syncBaseline = persisted<SyncBaseline | null>('stremio-sync-credential-baseline-v1', null)
export const stremioAddonLastSyncedAt = persisted<number>('stremio-addon-last-synced-at', 0)
export const stremioAddonSyncState = writable<StremioAddonSyncState>({ state: 'idle' })

function canonicalUrls(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeBase(value)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

/** Convert a modern HTTPS Stremio descriptor URL into Izumi's manifest-less base URL. */
export function stremioTransportBase(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/\/manifest\.json\/?$/i.test(url.pathname)) return ''
    url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '') || '/'
    url.hash = ''
    return normalizeBase(url.toString())
  } catch {
    return ''
  }
}

export function stremioTransportUrl(base: string): string {
  const normalized = normalizeBase(base)
  if (!normalized) throw new Error('The local Stremio add-on URL is invalid.')
  const url = new URL(normalized)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/manifest.json`
  return url.toString()
}

function protectedDescriptor(descriptor: StremioAddonDescriptor): boolean {
  return descriptor.flags?.protected === true
}

/**
 * Reconcile a local URL set against a freshly pulled Stremio collection.
 *
 * The first sync is a union. Later syncs compare both sides with their last common baseline:
 * additions are combined and a removal on either side wins. Remote-only/legacy descriptors are
 * never imported into Izumi, but are retained byte-for-byte for a subsequent collection write.
 */
export function reconcileStremioAddonUrls(
  localValues: readonly string[],
  remoteDescriptors: readonly StremioAddonDescriptor[],
  baselineValues?: readonly string[],
): StremioAddonReconciliation {
  const local = canonicalUrls(localValues)
  const baseline = baselineValues == null ? null : canonicalUrls(baselineValues)
  const remotePairs = remoteDescriptors.map((descriptor) => ({
    descriptor,
    base: stremioTransportBase(descriptor.transportUrl),
  }))
  const remote = canonicalUrls(remotePairs.map((item) => item.base).filter(Boolean))
  const remoteSet = new Set(remote)
  const localSet = new Set(local)
  const finalSet = new Set<string>(baseline == null ? [...remote, ...local] : [...baseline, ...remote, ...local])

  if (baseline != null) {
    for (const base of baseline) {
      if (!localSet.has(base) || !remoteSet.has(base)) finalSet.delete(base)
    }
  }
  for (const item of remotePairs) {
    if (item.base && protectedDescriptor(item.descriptor)) finalSet.add(item.base)
  }

  const urls = canonicalUrls([...remote, ...local]).filter((base) => finalSet.has(base))
  const retainedDescriptors = remotePairs
    .filter((item) => !item.base || finalSet.has(item.base))
    .map((item) => item.descriptor)
  const descriptorBasesToCreate = urls.filter((base) => !remoteSet.has(base))

  return {
    urls,
    retainedDescriptors,
    descriptorBasesToCreate,
    needsPush: retainedDescriptors.length !== remoteDescriptors.length || descriptorBasesToCreate.length > 0,
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

let applyingRemote = false

function applyLocalCollection(urls: readonly string[]): void {
  const current = canonicalUrls(get(addonUrls))
  const next = canonicalUrls(urls)
  const allowed = new Set(next)
  const nextDisabled = canonicalUrls(get(disabledSources)).filter((url) => allowed.has(url))
  applyingRemote = true
  try {
    if (!sameValues(current, next)) addonUrls.set(next)
    if (!sameValues(canonicalUrls(get(disabledSources)), nextDisabled)) disabledSources.set(nextDisabled)
  } finally {
    applyingRemote = false
  }
}

async function descriptorForBase(base: string): Promise<StremioAddonDescriptor> {
  const manifest = await fetchManifest(base)
  if (!manifest || !manifest.id || !manifest.name || !manifest.version) {
    throw new Error('A local Stremio add-on did not return a valid manifest. It was not uploaded.')
  }
  return {
    manifest: manifest as unknown as StremioAddonDescriptor['manifest'],
    transportUrl: stremioTransportUrl(base),
    flags: { official: false, protected: false },
  }
}

async function performSync(): Promise<StremioAddonSyncResult> {
  const sessionKey = get(stremioAuthKey)
  if (!sessionKey) throw new Error('Connect a Stremio account first.')
  stremioAddonSyncState.set({ state: 'syncing' })
  try {
    const accountId = get(stremioAccountId)
    const ensureSameSession = () => {
      if (get(stremioAuthKey) !== sessionKey || get(stremioAccountId) !== accountId) {
        throw new Error('Stremio add-on sync was cancelled because the account changed.')
      }
    }
    const previous = get(syncBaseline)
    const baseline = previous && previous.accountId === accountId ? previous.urls : undefined
    const remote = await pullStremioAddons()
    ensureSameSession()
    const plan = reconcileStremioAddonUrls(get(addonUrls), remote.addons, baseline)
    let pushed = false
    if (plan.needsPush) {
      const additions = [] as StremioAddonDescriptor[]
      for (const base of plan.descriptorBasesToCreate) additions.push(await descriptorForBase(base))
      ensureSameSession()
      await pushStremioAddons([...plan.retainedDescriptors, ...additions])
      pushed = true
    }

    ensureSameSession()
    applyLocalCollection(plan.urls)
    syncBaseline.set({ accountId, urls: plan.urls })
    const at = Date.now()
    stremioAddonLastSyncedAt.set(at)
    stremioAddonSyncState.set({ state: 'synced', count: plan.urls.length, pushed, at })
    return { count: plan.urls.length, pushed }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stremio add-on sync failed.'
    stremioAddonSyncState.set(get(stremioAuthKey) === sessionKey
      ? { state: 'error', message }
      : { state: 'idle' })
    throw error
  }
}

let syncTail: Promise<unknown> = Promise.resolve()

/** Serialize sync attempts so a fast sequence of local edits cannot publish an older collection. */
export function syncStremioAddons(): Promise<StremioAddonSyncResult> {
  const pending = syncTail.then(performSync, performSync)
  syncTail = pending.then(() => undefined, () => undefined)
  return pending
}

export function resetStremioAddonSync(): void {
  syncBaseline.set(null)
  stremioAddonLastSyncedAt.set(0)
  stremioAddonSyncState.set({ state: 'idle' })
}

let initialized = false

/** Pull on startup/focus and push debounced local add/remove/reconfigure operations. */
export function initStremioAddonSync(): () => void {
  if (initialized) return () => undefined
  initialized = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let primed = false
  const schedule = (delay = 1_200) => {
    if (!get(stremioAuthKey) || !navigator.onLine) return
    clearTimeout(timer)
    timer = setTimeout(() => { void syncStremioAddons().catch(() => undefined) }, delay)
  }
  const unsubscribe = addonUrls.subscribe(() => {
    if (!primed) {
      primed = true
      schedule(3_500)
      return
    }
    if (!applyingRemote) schedule()
  })
  const online = () => schedule(150)
  const visible = () => {
    if (document.visibilityState === 'visible' && Date.now() - get(stremioAddonLastSyncedAt) > 60_000) {
      schedule(250)
    }
  }
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visible)
  return () => {
    initialized = false
    clearTimeout(timer)
    unsubscribe()
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visible)
  }
}
