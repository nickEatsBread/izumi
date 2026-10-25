/** Loading a pack for review, applying it, and removing it again. The app-facing wiring (stores,
 *  installers, modules) comes in through `PackDeps`, so the order and rollback rules are testable on
 *  their own; `defaultPackDeps` in `deps.ts` connects the real app. */
import type { ModuleStatus } from '$lib/modules/modules'
import type { StoreAdapterId, StoreEntry } from '$lib/store/types'
import { canonicalStoreUrl } from '$lib/store/url'
import { compareVersions, MAX_PACK_BYTES, parsePack, type PackItem, type PackManifest } from './format'
import { sharedWithOtherPack, type PackRecord, type PackRecordItem } from './installed'

export interface ListingSummary {
  name: string
  signed: boolean
  fingerprint?: string
  adapter: StoreAdapterId
  entries: StoreEntry[]
}

export interface Installed {
  installedId: string
  name: string
  /** False when it was there before: undo and pack removal leave it. */
  added: boolean
  undo?: () => Promise<void>
}

export interface PackDeps {
  fetchText(url: string, maxBytes: number): Promise<string>
  sha256(text: string): Promise<string>
  appVersion(): Promise<string>
  locale(): string
  /** Canonical URLs of the stores already on this device. */
  knownStores(): string[]
  loadListing(url: string): Promise<ListingSummary>
  modules(): Promise<Record<string, ModuleStatus>>
  addStore(url: string, name: string, fingerprint?: string): void
  removeStore(url: string): void
  installSource(entry: StoreEntry, storeUrl: string, adapter: StoreAdapterId): Promise<Installed>
  installTheme(entry: StoreEntry, storeUrl: string, apply: boolean): Promise<Installed>
  removeItem(item: PackRecordItem): Promise<void>
  requestModule(id: string, by: string): Promise<void>
  releaseModule(id: string, by: string): Promise<void>
  setStartup(video: NonNullable<PackManifest['startup']>, by: string): Promise<void>
  clearStartup(by: string): Promise<void>
  installedPacks(): PackRecord[]
  saveRecord(record: PackRecord): void
  forgetRecord(id: string): void
  now(): number
}

export interface PlanStore {
  url: string
  name: string
  domain: string
  signed: boolean
  /** Already on this device before the pack. */
  known: boolean
  fingerprint?: string
  adapter?: StoreAdapterId
}

export interface PlanItem {
  item: PackItem
  entry?: StoreEntry
  storeName: string
}

export interface PackPlan {
  url: string
  sha256: string
  pack: PackManifest
  stores: PlanStore[]
  items: PlanItem[]
  /** Modules the pack asks for, with this device's status (`needed` false: skipped here). */
  modules: ModuleStatus[]
  /** Problems that stop the pack from being set up. */
  errors: string[]
}

/** The pack could not be read at all. */
export class PackLoadError extends Error {
  constructor(readonly errors: string[]) {
    super(errors[0] ?? 'The pack could not be read.')
  }
}

export function packBy(id: string): string {
  return `pack:${id}`
}

function domainOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Fetches a pack and everything the review screen shows about it. Store and module problems
 *  become plan errors (shown, and the pack can't be set up); an unreadable pack throws. */
export async function loadPackPlan(url: string, deps: PackDeps): Promise<PackPlan> {
  if (!canonicalStoreUrl(url)) throw new PackLoadError(['Packs must come from a public https link.'])
  let text: string
  try {
    text = await deps.fetchText(url, MAX_PACK_BYTES)
  } catch (error) {
    throw new PackLoadError([`The pack could not be downloaded: ${message(error)}`])
  }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new PackLoadError(['The pack is not valid JSON.']) }
  const parsed = parsePack(raw, url, deps.locale())
  if (!parsed.ok) throw new PackLoadError(parsed.errors)
  const pack = parsed.pack
  const errors: string[] = []

  if (pack.minAppVersion) {
    const version = await deps.appVersion().catch(() => '0.0.0')
    if (compareVersions(version, pack.minAppVersion) < 0) {
      errors.push(`This pack needs izumi ${pack.minAppVersion} or newer. Update izumi to use it.`)
    }
  }

  const known = new Set(deps.knownStores())
  const listings = new Map<string, ListingSummary>()
  const stores: PlanStore[] = []
  for (const storeUrl of pack.stores) {
    try {
      const listing = await deps.loadListing(storeUrl)
      listings.set(storeUrl, listing)
      stores.push({
        url: storeUrl, name: listing.name, domain: domainOf(storeUrl), signed: listing.signed, known: known.has(storeUrl),
        fingerprint: listing.fingerprint, adapter: listing.adapter,
      })
    } catch (error) {
      stores.push({ url: storeUrl, name: domainOf(storeUrl), domain: domainOf(storeUrl), signed: false, known: known.has(storeUrl) })
      errors.push(`The store at ${domainOf(storeUrl)} could not be loaded: ${message(error)}`)
    }
  }

  const items: PlanItem[] = pack.items.map((item) => {
    const listing = listings.get(item.store)
    const storeName = listing?.name ?? domainOf(item.store)
    if (!listing) return { item, storeName }
    const entry = listing.entries.find((candidate) => candidate.id === item.id && candidate.kind === item.kind)
    if (!entry) {
      errors.push(item.kind === 'source'
        ? `${storeName} doesn't list the source "${item.id}" for this device.`
        : `${storeName} doesn't list the theme "${item.id}".`)
    } else if (entry.install.type === 'addon' && entry.install.configureUrl) {
      errors.push(`${entry.name} has to be configured, which packs can't do yet.`)
    }
    return { item, entry, storeName }
  })

  const statuses = await deps.modules().catch(() => ({} as Record<string, ModuleStatus>))
  const modules: ModuleStatus[] = []
  for (const id of pack.modules) {
    const status = statuses[id]
    if (status) modules.push(status)
    else errors.push(`izumi has no module called "${id}". Update izumi to use this pack.`)
  }

  return { url, sha256: await deps.sha256(text), pack, stores, items, modules, errors }
}

export type ApplyStep =
  | { key: `store:${string}`; label: string }
  | { key: `item:${string}`; label: string }
  | { key: `module:${string}`; label: string }
  | { key: 'startup'; label: string }

/** The steps `applyPack` reports progress on, in order. */
export function applySteps(plan: PackPlan): ApplyStep[] {
  return [
    ...plan.stores.filter((store) => !store.known).map((store) => ({ key: `store:${store.url}` as const, label: `Add ${store.name}` })),
    ...plan.items.map((planned) => ({
      key: `item:${planned.item.ref}` as const,
      label: `${planned.item.kind === 'theme' ? 'Install theme' : 'Install'} ${planned.entry?.name ?? planned.item.id}`,
    })),
    ...plan.modules.filter((m) => m.needed).map((m) => ({ key: `module:${m.id}` as const, label: `Start downloading ${m.name}` })),
    ...(plan.pack.startup ? [{ key: 'startup' as const, label: 'Save the startup animation' }] : []),
  ]
}

export type StepState = 'working' | 'done' | 'failed'
export type ApplyProgress = (key: ApplyStep['key'], state: StepState, detail?: string) => void

/** The pack failed part-way: everything it added in this run was undone. */
export class PackApplyError extends Error {
  constructor(readonly step: ApplyStep['key'], cause: string) {
    super(cause)
  }
}

/** Applies a reviewed plan: stores, then items, then module requests and the startup animation,
 *  then the record. If a store or item fails, everything added in this run is undone (newest first)
 *  and PackApplyError is thrown. A startup animation that fails to download is reported and skipped:
 *  it is decoration. */
export async function applyPack(plan: PackPlan, deps: PackDeps, progress: ApplyProgress = () => {}): Promise<PackRecord> {
  if (plan.errors.length) throw new PackApplyError('startup', plan.errors[0])
  const by = packBy(plan.pack.id)
  const undo: Array<() => Promise<void>> = []
  const addedStores: string[] = []
  const items: PackRecordItem[] = []
  let current: ApplyStep['key'] = 'startup'

  const rollback = async () => {
    for (const step of undo.reverse()) {
      try { await step() } catch (error) { console.warn('[packs] rollback step failed', error) }
    }
  }

  try {
    for (const store of plan.stores.filter((s) => !s.known)) {
      current = `store:${store.url}`
      progress(current, 'working')
      deps.addStore(store.url, store.name, store.fingerprint)
      addedStores.push(store.url)
      undo.push(async () => deps.removeStore(store.url))
      progress(current, 'done')
    }
    for (const planned of plan.items) {
      current = `item:${planned.item.ref}`
      progress(current, 'working')
      const entry = planned.entry
      if (!entry) throw new Error(`${planned.item.id} is not available.`)
      const store = plan.stores.find((s) => s.url === planned.item.store)
      const result = planned.item.kind === 'theme'
        ? await deps.installTheme(entry, planned.item.store, planned.item.apply)
        : await deps.installSource(entry, planned.item.store, store?.adapter ?? 'izumi-store')
      if (result.undo) undo.push(result.undo)
      items.push({
        ref: planned.item.ref, kind: planned.item.kind, install: entry.install.type, installedId: result.installedId,
        name: result.name, store: planned.item.store, added: result.added,
      })
      progress(current, 'done', result.added ? undefined : 'Already installed')
    }
    const modules: string[] = []
    for (const status of plan.modules.filter((m) => m.needed)) {
      current = `module:${status.id}`
      progress(current, 'working')
      await deps.requestModule(status.id, by)
      modules.push(status.id)
      undo.push(() => deps.releaseModule(status.id, by))
      progress(current, 'done', 'Downloading in the background')
    }
    let startup = false
    if (plan.pack.startup) {
      current = 'startup'
      progress(current, 'working')
      try {
        await deps.setStartup(plan.pack.startup, by)
        startup = true
        undo.push(() => deps.clearStartup(by))
        progress(current, 'done')
      } catch (error) {
        progress(current, 'failed', message(error))
      }
    }
    const record: PackRecord = {
      id: plan.pack.id, name: plan.pack.name, version: plan.pack.version, url: plan.url, sha256: plan.sha256,
      author: plan.pack.author, icon: plan.pack.icon, appliedAt: deps.now(),
      items, addedStores, modules, startup, steps: plan.pack.steps,
    }
    deps.saveRecord(record)
    return record
  } catch (error) {
    progress(current, 'failed', message(error))
    await rollback()
    throw new PackApplyError(current, message(error))
  }
}

/** Removes what the pack added and nothing the user had before or another pack still uses. */
export async function removePack(record: PackRecord, deps: PackDeps): Promise<string[]> {
  const problems: string[] = []
  const others = deps.installedPacks().filter((pack) => pack.id !== record.id)
  const by = packBy(record.id)
  for (const item of [...record.items].reverse()) {
    if (!item.added || sharedWithOtherPack(others, record.id, { installedId: item.installedId })) continue
    try { await deps.removeItem(item) } catch (error) { problems.push(`${item.name}: ${message(error)}`) }
  }
  for (const id of record.modules) {
    try { await deps.releaseModule(id, by) } catch (error) { problems.push(`${id}: ${message(error)}`) }
  }
  if (record.startup) {
    try { await deps.clearStartup(by) } catch (error) { problems.push(`Startup animation: ${message(error)}`) }
  }
  for (const store of record.addedStores) {
    if (!sharedWithOtherPack(others, record.id, { store })) deps.removeStore(store)
  }
  deps.forgetRecord(record.id)
  return problems
}
