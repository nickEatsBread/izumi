/** What each applied pack added, so it can be shown and removed again (`pack-installs-v1`). Things
 *  the user already had before the pack are recorded as not added and are never removed with it. */
import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import type { InstallRef } from '$lib/store/types'
import type { PackItemKind, PackStep } from './format'

export interface PackRecordItem {
  ref: string
  kind: PackItemKind
  /** How it was installed, which decides how it is removed. */
  install: InstallRef['type']
  /** Package id, addon base, extension spec or theme id. */
  installedId: string
  name: string
  store: string
  /** False when it was installed before the pack: removing the pack leaves it. */
  added: boolean
}

/** A source screen the pack switched on, and what it changed to do so. */
export interface PackScreen {
  packageId: string
  /** The screen was not on before the pack. */
  addedProvider: boolean
  /** The startup screen before the pack made this one the startup screen. */
  previousDefault?: string
}

export interface PackRecord {
  id: string
  name: string
  version: string
  url: string
  sha256: string
  author?: string
  icon?: string
  appliedAt: number
  items: PackRecordItem[]
  /** Stores the pack added (not the ones that were there already). */
  addedStores: string[]
  modules: string[]
  startup: boolean
  steps: PackStep[]
  screens?: PackScreen[]
}

export const installedPacks = persisted<PackRecord[]>('pack-installs-v1', [])

export function packRecord(id: string): PackRecord | undefined {
  return get(installedPacks).find((pack) => pack.id === id)
}

export function savePackRecord(record: PackRecord): void {
  installedPacks.update((packs) => [...packs.filter((pack) => pack.id !== record.id), record])
}

export function forgetPackRecord(id: string): void {
  installedPacks.update((packs) => packs.filter((pack) => pack.id !== id))
}

/** True when another applied pack also relies on this item or store, so removing one pack keeps it. */
export function sharedWithOtherPack(packs: PackRecord[], packId: string, match: { installedId?: string; store?: string }): boolean {
  return packs.some((pack) => pack.id !== packId && (
    (match.installedId !== undefined && pack.items.some((item) => item.installedId === match.installedId))
    || (match.store !== undefined && (pack.addedStores.includes(match.store) || pack.items.some((item) => item.store === match.store)))
  ))
}
