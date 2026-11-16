/** `pack.json` (packs v1): a bundle that sets izumi up for one purpose — stores to add, sources and a
 *  theme to install from them, native modules to fetch, a startup animation and setup steps. Pure:
 *  the caller fetches. Everything a pack names is listed on the review screen before it applies. */
import { canonicalStoreUrl, resolveStoreUrl } from '$lib/store/url'

export const MAX_PACK_BYTES = 64_000
export const MAX_PACK_ITEMS = 20
export const MAX_PACK_STEPS = 8
export const MAX_STARTUP_VIDEO_BYTES = 16 << 20

const ID = /^[a-z0-9][a-z0-9.-]{1,63}$/
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const SHA256 = /^[a-f0-9]{64}$/i
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

export type PackItemKind = 'source' | 'theme'

export interface PackItem {
  ref: string
  kind: PackItemKind
  /** Canonical URL of the store the item installs (and keeps updating) from. */
  store: string
  /** The entry id in that store. */
  id: string
  /** Themes: make it the active theme. */
  apply: boolean
  /** Sources that serve their own catalog: add its screen (`on`), and open izumi on it (`default`). */
  screen?: 'on' | 'default'
}

export interface PackStep {
  kind: 'source-settings'
  /** The pack item (`ref`) whose source settings the step shows. */
  item: string
  title?: string
}

export interface PackStartupVideo {
  url: string
  sha256: string
  bytes: number
}

export interface PackManifest {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  icon?: string
  banner?: string
  homepage?: string
  minAppVersion?: string
  stores: string[]
  items: PackItem[]
  modules: string[]
  startup?: PackStartupVideo
  steps: PackStep[]
}

export type PackParse = { ok: true; pack: PackManifest } | { ok: false; errors: string[] }

/** A string, or `{lang: text}` with English as the fallback. */
export function localized(value: unknown, locale: string, max: number): string | undefined {
  let picked: unknown = value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const table = value as Record<string, unknown>
    const base = locale.split('-')[0]
    picked = Object.hasOwn(table, locale) ? table[locale] : Object.hasOwn(table, base) ? table[base] : table.en
  }
  return typeof picked === 'string' && picked.trim() && picked.length <= max ? picked.trim() : undefined
}

function https(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return undefined
  try {
    const url = new URL(value, base)
    return canonicalStoreUrl(url.href) ? url.href : undefined
  } catch {
    return undefined
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && value !== 'constructor' && value !== 'prototype'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** -1, 0 or 1 for N.N.N versions; anything else sorts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (VERSION.test(v) ? v.split('.').map(Number) : [0, 0, 0])
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** Validates a pack. Every problem is reported, so the review screen can list them all. */
export function parsePack(raw: unknown, packUrl: string, locale = 'en'): PackParse {
  const errors: string[] = []
  const doc = record(raw)
  if (!doc || doc.app !== 'izumi' || doc.kind !== 'pack') return { ok: false, errors: ['That is not an izumi pack.'] }
  if (doc.schemaVersion !== 1) {
    return { ok: false, errors: [typeof doc.schemaVersion === 'number' && doc.schemaVersion > 1 ? 'This pack needs a newer izumi.' : 'This pack has no valid schemaVersion.'] }
  }
  const id = validId(doc.id) ? doc.id : undefined
  if (!id) errors.push('The pack id is missing or invalid.')
  const name = localized(doc.name, locale, 64)
  if (!name) errors.push('The pack has no name.')
  const version = typeof doc.version === 'string' && VERSION.test(doc.version) ? doc.version : undefined
  if (!version) errors.push('The pack version must look like 1.0.0.')
  let minAppVersion: string | undefined
  if (doc.minAppVersion !== undefined) {
    if (typeof doc.minAppVersion === 'string' && VERSION.test(doc.minAppVersion)) minAppVersion = doc.minAppVersion
    else errors.push('minAppVersion must look like 0.1.75.')
  }

  const stores: string[] = []
  const addStore = (value: unknown, where: string): string | undefined => {
    const url = typeof value === 'string' ? resolveStoreUrl(value) : null
    if (!url) {
      errors.push(`${where}: stores must be public HTTPS links.`)
      return undefined
    }
    if (!stores.includes(url)) stores.push(url)
    return url
  }
  if (doc.stores !== undefined && !Array.isArray(doc.stores)) errors.push('stores must be a list.')
  for (const [index, entry] of (Array.isArray(doc.stores) ? doc.stores : []).slice(0, MAX_PACK_ITEMS).entries()) {
    addStore(record(entry)?.url, `Store ${index + 1}`)
  }

  const items: PackItem[] = []
  const rawItems = Array.isArray(doc.items) ? doc.items : []
  if (doc.items !== undefined && !Array.isArray(doc.items)) errors.push('items must be a list.')
  if (rawItems.length > MAX_PACK_ITEMS) errors.push(`A pack lists at most ${MAX_PACK_ITEMS} items.`)
  for (const [index, entry] of rawItems.slice(0, MAX_PACK_ITEMS).entries()) {
    const item = record(entry)
    const where = `Item ${index + 1}`
    const ref = typeof item?.ref === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(item.ref) ? item.ref : undefined
    const kind = item?.kind === 'source' || item?.kind === 'theme' ? item.kind : undefined
    const from = record(item?.from)
    if (!ref) { errors.push(`${where}: ref is missing or invalid.`); continue }
    if (items.some((other) => other.ref === ref)) { errors.push(`${where}: ref "${ref}" is used twice.`); continue }
    if (!kind) { errors.push(`${where}: kind must be source or theme.`); continue }
    if (!from) { errors.push(`${where}: items install from a store ("from").`); continue }
    const store = addStore(from.store, where)
    const entryId = validId(from.id) ? from.id : undefined
    if (!entryId) errors.push(`${where}: from.id is missing or invalid.`)
    const screen = item?.screen === true ? 'on' : item?.screen === 'default' ? 'default' : undefined
    if (item?.screen !== undefined && (!screen || kind !== 'source')) errors.push(`${where}: screen is true or "default", on a source.`)
    if (store && entryId) {
      items.push({ ref, kind, store, id: entryId, apply: kind === 'theme' && item?.apply === true, ...(screen && kind === 'source' ? { screen } : {}) })
    }
  }
  if (items.filter((item) => item.apply).length > 1) errors.push('Only one theme can be applied.')
  if (items.filter((item) => item.screen === 'default').length > 1) errors.push('Only one screen can open at startup.')

  const modules: string[] = []
  if (doc.modules !== undefined && !Array.isArray(doc.modules)) errors.push('modules must be a list.')
  for (const entry of Array.isArray(doc.modules) ? doc.modules.slice(0, 8) : []) {
    const moduleId = record(entry)?.id
    if (typeof moduleId === 'string' && MODULE_ID.test(moduleId)) {
      if (!modules.includes(moduleId)) modules.push(moduleId)
    } else errors.push('A module entry has no valid id.')
  }

  let startup: PackStartupVideo | undefined
  if (doc.startup !== undefined) {
    const video = record(record(doc.startup)?.video)
    const url = https(video?.url, packUrl)
    const sha = typeof video?.sha256 === 'string' && SHA256.test(video.sha256) ? video.sha256.toLowerCase() : undefined
    const bytes = typeof video?.bytes === 'number' && Number.isSafeInteger(video.bytes) && video.bytes > 0 ? video.bytes : undefined
    if (!url || !sha || !bytes) errors.push('The startup animation needs an https url, sha256 and bytes.')
    else if (bytes > MAX_STARTUP_VIDEO_BYTES) errors.push('The startup animation is larger than 16 MB.')
    else startup = { url, sha256: sha, bytes }
  }

  const steps: PackStep[] = []
  const setup = record(doc.setup)
  const rawSteps = Array.isArray(setup?.steps) ? setup.steps : []
  if (rawSteps.length > MAX_PACK_STEPS) errors.push(`A pack has at most ${MAX_PACK_STEPS} setup steps.`)
  for (const [index, entry] of rawSteps.slice(0, MAX_PACK_STEPS).entries()) {
    const step = record(entry)
    const where = `Setup step ${index + 1}`
    const target = items.find((item) => item.ref === step?.item)
    if (step?.step !== 'settings' || typeof step.item !== 'string') {
      errors.push(`${where}: izumi only knows source settings steps ({"item": "<ref>", "step": "settings"}).`)
    } else if (!target || target.kind !== 'source') {
      errors.push(`${where}: "${step.item}" is not one of the pack's sources.`)
    } else {
      steps.push({ kind: 'source-settings', item: target.ref, title: localized(step.title, locale, 64) })
    }
  }

  if (errors.length || !id || !name || !version) return { ok: false, errors }
  return {
    ok: true,
    pack: {
      id,
      name,
      version,
      author: localized(doc.author, locale, 80),
      description: localized(doc.description, locale, 600),
      icon: https(doc.icon, packUrl),
      banner: https(doc.banner, packUrl),
      homepage: https(doc.homepage, packUrl),
      minAppVersion,
      stores,
      items,
      modules,
      startup,
      steps,
    },
  }
}
