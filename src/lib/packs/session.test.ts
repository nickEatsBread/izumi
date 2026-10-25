import { describe, expect, it, vi } from 'vitest'
import type { ModuleStatus } from '$lib/modules/modules'
import type { StoreEntry } from '$lib/store/types'
import type { PackRecord } from './installed'
import { applyPack, applySteps, loadPackPlan, PackApplyError, PackLoadError, removePack, type PackDeps } from './session'

const PACK_URL = 'https://example.github.io/pack/pack.json'
const STORE = 'https://example.github.io/pack/store.json'

function entry(id: string, kind: 'source' | 'theme'): StoreEntry {
  return {
    key: `s:${kind}:${id}`, storeId: 's', kind, id, name: id.toUpperCase(), languages: [], content: [], nsfw: false, requiresDebrid: false,
    install: kind === 'theme'
      ? { type: 'theme', release: {} as never }
      : { type: 'package', pkg: { id, name: id, version: '1.0.0', nsfw: false, sources: [], backend: 'izumi-service', package: 'https://x.test/p', packageSha256: 'a'.repeat(64), packageBytes: 1 } },
  }
}

function moduleStatus(id: string, needed = true): ModuleStatus {
  return { id, name: 'Widevine', purpose: '', publisher: 'Google', approxBytes: 1, licence: 'L', needed, wanted: false, requestedBy: [], state: 'idle', received: 0, total: 0, version: null, error: null }
}

const PACK = {
  app: 'izumi', kind: 'pack', schemaVersion: 1, id: 'io.github.example.pack', name: 'Example', version: '1.0.0', minAppVersion: '0.1.75',
  items: [
    { ref: 'source', kind: 'source', from: { store: STORE, id: 'example.source' } },
    { ref: 'look', kind: 'theme', from: { store: STORE, id: 'example-look' }, apply: true },
  ],
  modules: [{ id: 'widevine' }],
  startup: { video: { url: 'intro.mp4', sha256: 'a'.repeat(64), bytes: 10 } },
  setup: { steps: [{ item: 'source', step: 'settings' }] },
}

function fakeDeps(overrides: Partial<PackDeps> = {}) {
  const log: string[] = []
  let records: PackRecord[] = []
  const deps: PackDeps = {
    fetchText: async () => JSON.stringify(PACK),
    sha256: async () => 'f'.repeat(64),
    appVersion: async () => '0.1.75',
    locale: () => 'en',
    knownStores: () => [],
    loadListing: async () => ({ name: 'Example Store', signed: true, fingerprint: 'fp', adapter: 'izumi-store', entries: [entry('example.source', 'source'), entry('example-look', 'theme')] }),
    modules: async () => ({ widevine: moduleStatus('widevine') }),
    addStore: (url) => { log.push(`add-store ${url}`) },
    removeStore: (url) => { log.push(`remove-store ${url}`) },
    installSource: async (e) => { log.push(`install ${e.id}`); return { installedId: e.id, name: e.name, added: true, undo: async () => { log.push(`undo ${e.id}`) } } },
    installTheme: async (e, _s, apply) => { log.push(`theme ${e.id} apply=${apply}`); return { installedId: e.id, name: e.name, added: true, undo: async () => { log.push(`undo ${e.id}`) } } },
    removeItem: async (item) => { log.push(`remove ${item.installedId}`) },
    requestModule: async (id, by) => { log.push(`want ${id} ${by}`) },
    releaseModule: async (id, by) => { log.push(`release ${id} ${by}`) },
    showSourceScreen: async (packageId, makeDefault) => { log.push(`screen ${packageId} default=${makeDefault}`); return { packageId, addedProvider: true } },
    hideSourceScreen: (screen) => { log.push(`hide-screen ${screen.packageId}`) },
    setStartup: async (_v, by) => { log.push(`startup ${by}`) },
    clearStartup: async (by) => { log.push(`clear-startup ${by}`) },
    installedPacks: () => records,
    saveRecord: (record) => { records = [...records.filter((r) => r.id !== record.id), record] },
    forgetRecord: (id) => { records = records.filter((r) => r.id !== id) },
    now: () => 1000,
    ...overrides,
  }
  return { deps, log, records: () => records }
}

describe('pack session', () => {
  it('loads a plan with stores, entries and module status', async () => {
    const { deps } = fakeDeps()
    const plan = await loadPackPlan(PACK_URL, deps)
    expect(plan.errors).toEqual([])
    expect(plan.stores).toEqual([{ url: STORE, name: 'Example Store', domain: 'example.github.io', signed: true, known: false, fingerprint: 'fp', adapter: 'izumi-store' }])
    expect(plan.items.map((i) => i.entry?.id)).toEqual(['example.source', 'example-look'])
    expect(plan.modules.map((m) => m.id)).toEqual(['widevine'])
    expect(applySteps(plan).map((s) => s.key)).toEqual([`store:${STORE}`, 'item:source', 'item:look', 'module:widevine', 'startup'])
  })

  it('reports what blocks a pack instead of half-applying it', async () => {
    const { deps } = fakeDeps({
      appVersion: async () => '0.1.74',
      loadListing: async () => ({ name: 'Example Store', signed: false, adapter: 'izumi-store', entries: [entry('example-look', 'theme')] }),
      modules: async () => ({}),
    })
    const plan = await loadPackPlan(PACK_URL, deps)
    expect(plan.errors).toEqual([
      'This pack needs izumi 0.1.75 or newer. Update izumi to use it.',
      'Example Store doesn\'t list the source "example.source" for this device.',
      'izumi has no module called "widevine". Update izumi to use this pack.',
    ])
    await expect(applyPack(plan, deps)).rejects.toBeInstanceOf(PackApplyError)
  })

  it('throws for a pack it cannot read', async () => {
    await expect(loadPackPlan(PACK_URL, fakeDeps({ fetchText: async () => '<html>' }).deps)).rejects.toBeInstanceOf(PackLoadError)
  })

  it('applies in order, asks for modules on the pack\'s behalf and records what it added', async () => {
    const { deps, log, records } = fakeDeps()
    const plan = await loadPackPlan(PACK_URL, deps)
    const seen: string[] = []
    const record = await applyPack(plan, deps, (key, state) => seen.push(`${key}:${state}`))
    expect(log).toEqual([
      `add-store ${STORE}`,
      'install example.source',
      'theme example-look apply=true',
      'want widevine pack:io.github.example.pack',
      'startup pack:io.github.example.pack',
    ])
    expect(seen.filter((s) => s.endsWith(':done'))).toHaveLength(5)
    expect(record).toMatchObject({ id: 'io.github.example.pack', addedStores: [STORE], modules: ['widevine'], startup: true })
    expect(records()).toHaveLength(1)
  })

  it('skips modules this device does not need', async () => {
    const { deps, log } = fakeDeps({ modules: async () => ({ widevine: moduleStatus('widevine', false) }) })
    const record = await applyPack(await loadPackPlan(PACK_URL, deps), deps)
    expect(log.some((line) => line.startsWith('want'))).toBe(false)
    expect(record.modules).toEqual([])
  })

  it('undoes everything from this run, newest first, when an item fails', async () => {
    const { deps, log, records } = fakeDeps({ installTheme: async () => { throw new Error('theme broke') } })
    const plan = await loadPackPlan(PACK_URL, deps)
    const progress = vi.fn()
    await expect(applyPack(plan, deps, progress)).rejects.toThrow('theme broke')
    expect(log).toEqual([`add-store ${STORE}`, 'install example.source', 'undo example.source', `remove-store ${STORE}`])
    expect(progress).toHaveBeenCalledWith('item:look', 'failed', 'theme broke')
    expect(records()).toEqual([])
  })

  it('keeps going when only the startup animation fails', async () => {
    const { deps } = fakeDeps({ setStartup: async () => { throw new Error('offline') } })
    const progress = vi.fn()
    const record = await applyPack(await loadPackPlan(PACK_URL, deps), deps, progress)
    expect(record.startup).toBe(false)
    expect(progress).toHaveBeenCalledWith('startup', 'failed', 'offline')
  })

  it('switches on the screen of a source after installing it, and switches it off on removal', async () => {
    const withScreen = { ...PACK, items: [{ ...PACK.items[0], screen: 'default' }, PACK.items[1]] }
    const { deps, log } = fakeDeps({ fetchText: async () => JSON.stringify(withScreen) })
    const plan = await loadPackPlan(PACK_URL, deps)
    expect(applySteps(plan).map((s) => s.key)).toContain('screen:source')
    const record = await applyPack(plan, deps)
    expect(log.indexOf('screen example.source default=true')).toBeGreaterThan(log.indexOf('theme example-look apply=true'))
    expect(record.screens).toEqual([{ packageId: 'example.source', addedProvider: true }])
    log.length = 0
    await removePack(record, deps)
    expect(log[0]).toBe('hide-screen example.source')
  })

  it('keeps going when a screen cannot be added yet', async () => {
    const withScreen = { ...PACK, items: [{ ...PACK.items[0], screen: true }, PACK.items[1]] }
    const { deps } = fakeDeps({ fetchText: async () => JSON.stringify(withScreen), showSourceScreen: async () => { throw new Error('not running') } })
    const progress = vi.fn()
    const record = await applyPack(await loadPackPlan(PACK_URL, deps), deps, progress)
    expect(record.screens).toBeUndefined()
    expect(progress).toHaveBeenCalledWith('screen:source', 'failed', 'not running')
  })

  it('removes only what the pack added and no other pack uses', async () => {
    const { deps, log } = fakeDeps({
      installSource: async (e) => ({ installedId: e.id, name: e.name, added: false }),
    })
    const record = await applyPack(await loadPackPlan(PACK_URL, deps), deps)
    deps.saveRecord({ ...record, id: 'other.pack', addedStores: [], modules: [], startup: false, items: record.items.filter((i) => i.kind === 'theme') })
    log.length = 0
    expect(await removePack(record, deps)).toEqual([])
    expect(log).toEqual([
      'release widevine pack:io.github.example.pack',
      'clear-startup pack:io.github.example.pack',
    ])
  })
})
