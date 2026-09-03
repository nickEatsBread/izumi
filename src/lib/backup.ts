export interface AppBackup {
  app: 'izumi'
  kind: 'app-backup'
  version: 1
  exportedAt: number
  includesSecrets: boolean
  localStorage: Record<string, string>
}

const secretKey = /(token|secret|password|credential|api.?key|jwt|debrid|opensubtitles-creds|addon.*url)/i

export function createBackup(storage: Storage, includeSecrets = false): AppBackup {
  const values: Record<string, string> = {}
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || (!includeSecrets && secretKey.test(key))) continue
    const value = storage.getItem(key)
    if (value != null) values[key] = value
  }
  return {
    app: 'izumi',
    kind: 'app-backup',
    version: 1,
    exportedAt: Date.now(),
    includesSecrets: includeSecrets,
    localStorage: values,
  }
}

export function stringifyBackup(storage: Storage, includeSecrets = false) {
  return JSON.stringify(createBackup(storage, includeSecrets), null, 2)
}

export function parseBackup(text: string): AppBackup {
  const value = JSON.parse(text) as Partial<AppBackup>
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
  return value as AppBackup
}

/** Merge a validated backup, rolling back all touched keys if storage quota/write fails. */
export function restoreBackup(storage: Storage, backup: AppBackup) {
  const previous = new Map<string, string | null>()
  try {
    for (const [key, value] of Object.entries(backup.localStorage)) {
      previous.set(key, storage.getItem(key))
      storage.setItem(key, value)
    }
  } catch (error) {
    for (const [key, value] of previous) {
      if (value == null) storage.removeItem(key)
      else storage.setItem(key, value)
    }
    throw error
  }
  return previous.size
}
