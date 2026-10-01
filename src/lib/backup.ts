import { exportLibraryStorage, isLibraryCollection, restoreLibraryStorage } from '$lib/storage/library-db'
import { classifyStorageKey, exportDecision, harvestSecretStrings, mergeFieldValue, redactFieldValue } from '$lib/storage/key-policy'
// Household backups are gated on restricted profiles: each export or restore uses up a one-shot
// grant from authorizeHousehold (spec §6.6).
import { assertHouseholdAction } from '$lib/profiles/household-gate'

export interface AppBackup {
  app: 'izumi'
  kind: 'app-backup'
  version: 1
  exportedAt: number
  includesSecrets: boolean
  localStorage: Record<string, string>
  /** What the storage-key policy kept out of this file: keys left out (secrets, and settings whose
   *  value embeds one) and notes about partly redacted values. Absent in files from older builds;
   *  older builds read files that have it unchanged (the version stays 1). */
  redacted?: { keys: string[]; notes: string[] }
}

const REDACTED = '[redacted]'
const LIBRARY_NOTE = 'Text in the watch history or library that matched a sign-in or key was replaced with [redacted].'

function storageEntries(storage: Storage): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key) continue
    const value = storage.getItem(key)
    if (value != null) values[key] = value
  }
  return values
}

/** The watch history and library are too valuable to leave out because one media snapshot quotes a
 *  harvested string: each one is replaced instead, longest first so a shorter string cannot split a
 *  longer one. null = the replaced text no longer parses (the string spanned JSON syntax), so the
 *  caller leaves the key out. */
function withoutHarvested(value: string, harvested: readonly string[]): string | null {
  const text = [...harvested]
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.split(secret).join(REDACTED), value)
  try {
    JSON.parse(text)
    return text
  } catch {
    return null
  }
}

/** Apply the storage-key policy (settings fix pass §6.1, §6.2) to a key/value snapshot. Device and
 *  transient keys are never exported. Without secrets, secret keys are left out, fields keys lose
 *  their credential field, and any other setting whose value embeds a harvested secret string is left
 *  out too, apart from the library collections, which keep their value with that text replaced.
 *  Reviewed keys always go as they are, so izumi-profiles-v1 keeps its PIN verifiers in both modes
 *  (§6.3). */
export function createBackupFromEntries(entries: Record<string, string>, includeSecrets: boolean): AppBackup {
  const values: Record<string, string> = {}
  const keys: string[] = []
  const notes = new Set<string>()
  const harvested = includeSecrets ? [] : harvestSecretStrings(entries)
  for (const [key, value] of Object.entries(entries)) {
    if (!key) continue
    const decision = exportDecision(key, includeSecrets)
    if (decision === 'skip') continue
    if (decision === 'redact') {
      keys.push(key)
      continue
    }
    const kind = classifyStorageKey(key)
    let exported = value
    if (kind === 'fields' && !includeSecrets) {
      const redaction = redactFieldValue(key, value)
      if (redaction.note) notes.add(redaction.note)
      if (redaction.value == null) {
        keys.push(key)
        continue
      }
      exported = redaction.value
    }
    if (kind !== 'reviewed' && harvested.some((secret) => exported.includes(secret))) {
      const kept = isLibraryCollection(key) ? withoutHarvested(exported, harvested) : null
      if (kept == null) {
        keys.push(key)
        continue
      }
      notes.add(LIBRARY_NOTE)
      exported = kept
    }
    values[key] = exported
  }
  return {
    app: 'izumi',
    kind: 'app-backup',
    version: 1,
    exportedAt: Date.now(),
    includesSecrets: includeSecrets,
    localStorage: values,
    redacted: { keys: keys.sort(), notes: [...notes] },
  }
}

export function createBackup(storage: Storage, includeSecrets = false): AppBackup {
  return createBackupFromEntries(storageEntries(storage), includeSecrets)
}

export async function stringifyBackup(storage: Storage, includeSecrets = false) {
  assertHouseholdAction('backup-export')
  const library = await exportLibraryStorage()
  // An inactive profile may still have a legacy value written by an older app version. Match
  // migration's precedence instead of replacing that value with an older database snapshot.
  return JSON.stringify(createBackupFromEntries({ ...library, ...storageEntries(storage) }, includeSecrets), null, 2)
}

type BackupJson = {
  app?: unknown
  kind?: unknown
  version?: unknown
  localStorage?: unknown
  redacted?: unknown
}

/** Keeps the string entries of a well-formed `redacted`; anything else reads as absent. Notes are
 *  de-duplicated: the restore preview keys its list by note text. */
function readRedacted(value: unknown): AppBackup['redacted'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { keys, notes } = value as { keys?: unknown; notes?: unknown }
  const strings = (list: unknown): string[] => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  return { keys: strings(keys), notes: [...new Set(strings(notes))] }
}

export function parseBackup(text: string): AppBackup {
  const parsed: unknown = JSON.parse(text)
  const value = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as BackupJson
  if (value.app === 'izumi' && value.kind === 'app-backup' && typeof value.version === 'number' && value.version > 1) {
    throw new Error('This backup was made by a newer version of Izumi.')
  }
  if (
    value.app !== 'izumi'
    || value.kind !== 'app-backup'
    || value.version !== 1
    || !value.localStorage
    || typeof value.localStorage !== 'object'
    || Array.isArray(value.localStorage)
  ) {
    throw new Error('Not an Izumi app backup.')
  }
  for (const [key, item] of Object.entries(value.localStorage)) {
    if (!key || typeof item !== 'string') throw new Error('The backup contains an invalid setting.')
  }
  const backup = value as AppBackup
  const redacted = readRedacted(value.redacted)
  if (redacted) backup.redacted = redacted
  else delete backup.redacted
  return backup
}

/** Merge a validated backup under the storage-key policy, rolling back all touched keys if storage
 *  quota/write fails. Transient and device keys are always skipped. Secret keys are skipped when the
 *  file says it has none (older builds leaked some into such files). Fields keys merge with this
 *  device's value. */
export async function restoreBackup(storage: Storage, backup: AppBackup) {
  assertHouseholdAction('backup-restore')
  const accepted: Record<string, string> = {}
  for (const [key, value] of Object.entries(backup.localStorage)) {
    const kind = classifyStorageKey(key)
    if (kind === 'transient' || kind === 'device') continue
    if (kind === 'secret' && backup.includesSecrets === false) continue
    accepted[key] = kind === 'fields' ? mergeFieldValue(key, value, storage.getItem(key)) : value
  }
  const previous = new Map<string, string | null>()
  try {
    for (const [key, value] of Object.entries(accepted)) {
      previous.set(key, storage.getItem(key))
      if (isLibraryCollection(key)) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    await restoreLibraryStorage(accepted)
  } catch (error) {
    for (const [key, value] of previous) {
      if (value == null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    throw error
  }
  return previous.size
}
