import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackup, createBackupFromEntries, parseBackup, restoreBackup, stringifyBackup, type AppBackup } from './backup'
import { ioErrorMessage } from './player/history-io'

// The household gate is a no-op here unless a test says otherwise (spec §6.6 "gate asserts").
const gate = vi.hoisted(() => ({ assertHouseholdAction: vi.fn() }))
vi.mock('$lib/profiles/household-gate', () => ({ assertHouseholdAction: gate.assertHouseholdAction }))

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('full application backup', () => {
  it('redacts secrets unless explicitly included', () => {
    const storage = new MemoryStorage()
    storage.setItem('nav-config-v1', '[]')
    storage.setItem('debrid-key', '"secret"')
    storage.setItem('stremio-addon-urls', '["https://addon.test/private-token"]')
    storage.setItem('stremio-account-token', '"session"')
    storage.setItem('stremio-sync-credential-baseline-v1', '{"urls":[]}')
    expect(createBackup(storage).localStorage).toEqual({ 'nav-config-v1': '[]' })
    expect(createBackup(storage, true).localStorage['debrid-key']).toBe('"secret"')
    expect(createBackup(storage, true).localStorage['stremio-addon-urls']).toContain('private-token')
  })

  it('includes local list tracking and its automatic threshold', () => {
    const storage = new MemoryStorage()
    storage.setItem('local-media-library-v1', '{"entries":{"anime":{"tracking":{"status":"DROPPED"}}}}')
    storage.setItem('auto-watchlist-enabled', 'true')
    storage.setItem('auto-watchlist-episodes', '3')
    expect(createBackup(storage).localStorage).toMatchObject({
      'local-media-library-v1': expect.stringContaining('DROPPED'),
      'auto-watchlist-enabled': 'true',
      'auto-watchlist-episodes': '3',
    })
  })

  it('validates and restores values', async () => {
    const storage = new MemoryStorage()
    const backup = parseBackup(JSON.stringify({
      app: 'izumi', kind: 'app-backup', version: 1, exportedAt: 1, includesSecrets: false,
      localStorage: { 'home-row-order': '["continue"]', 'extension-urls': '[]' },
    }))
    expect(await restoreBackup(storage, backup)).toBe(2)
    expect(storage.getItem('home-row-order')).toBe('["continue"]')
  })
})

const HOUSEHOLD = JSON.stringify({
  profiles: [
    { id: 'default', name: 'Main profile', color: '#ef476f', createdAt: 0, ratingLimit: 18, allowAdult: true, pin: { salt: '00ff00ff00ff00ff', hash: 'ab'.repeat(32) } },
    { id: 'profile-kid', name: 'Kid', color: '#2a9d8f', createdAt: 1, ratingLimit: 12, allowAdult: false },
  ],
  enabled: true,
})
const DOWNLOAD_WITHOUT_LINK = { id: '1:1', mediaId: 1, episode: 1, title: 'Episode 1', bytes: 1, downloaded: 1, status: 'done', addedAt: 1 }
/** One value of every class. Every string that must stay home without secrets contains LEAK. */
const SNAPSHOT: Record<string, string> = {
  'nav-config-v1': '[]',
  'debrid-key': '"LEAK-debrid-0123456789"',
  'debrid-provider': '"provider-a"',
  'debrid-room-notice-ack': 'true',
  'stremio-addon-urls': JSON.stringify(['https://addon.test/manifest.json', 'https://addon.test/LEAK-config-0123456789/manifest.json']),
  'dead-sources-v6': JSON.stringify({ 'https://addon.test/LEAK-config-0123456789': 3 }),
  'source-priority': JSON.stringify(['https://addon.test/manifest.json']),
  'mal-refresh': '"LEAK-mal-refresh-main"',
  'izumi-profile:profile-kid:mal-refresh': '"LEAK-mal-refresh-kid"',
  'izumi-profile:profile-kid:trakt-browser-auth-v1': '{"state":"LEAK-oauth-state"}',
  'nuvio-auth-tokens-v1': JSON.stringify({ accessToken: 'LEAK-nuvio-access-0123', refreshToken: 'LEAK-nuvio-refresh-0123', expiresAt: 1, userId: 'user-1', email: 'a@b.test' }),
  'cloudflare-sync-config-v1': JSON.stringify({ groupKey: 'LEAK-group-key-0123', deviceToken: 'LEAK-device-token-0123' }),
  'cloudflare-sync-setup-secret-v1': '"LEAK-setup-secret-0123"',
  'paired-tizen-companions-v1': JSON.stringify([{ deviceId: 'tv-1', tvToken: 'LEAK-tv-token-0123' }]),
  'izumi-active-profile-v1': '"default"',
  downloads: JSON.stringify({ '1:1': { ...DOWNLOAD_WITHOUT_LINK, url: 'https://debrid.test/dl/LEAK-link-0123' } }),
  'torrent-proxy-url': '"socks5://proxyuser:LEAK-proxy-password@127.0.0.1:1080"',
  'torrent-proxy-enabled': 'true',
  'trakt-client-id': '"public-client-id"',
  'izumi-profiles-v1': HOUSEHOLD,
}

function storageWith(entries: Record<string, string>): MemoryStorage {
  const storage = new MemoryStorage()
  for (const [key, value] of Object.entries(entries)) storage.setItem(key, value)
  return storage
}

describe('storage-key policy in backups', () => {
  it('leaves every sign-in, key and device identity out of a backup without secrets', () => {
    const backup = createBackup(storageWith(SNAPSHOT))
    expect(JSON.stringify(backup)).not.toContain('LEAK')
    expect(backup.localStorage).toEqual({
      'nav-config-v1': '[]',
      'debrid-provider': '"provider-a"',
      'debrid-room-notice-ack': 'true',
      'source-priority': JSON.stringify(['https://addon.test/manifest.json']),
      downloads: JSON.stringify({ '1:1': DOWNLOAD_WITHOUT_LINK }),
      'torrent-proxy-url': '"socks5://127.0.0.1:1080"',
      'torrent-proxy-enabled': 'true',
      'trakt-client-id': '"public-client-id"',
      'izumi-profiles-v1': HOUSEHOLD,
    })
    expect(backup.redacted).toEqual({
      keys: ['dead-sources-v6', 'debrid-key', 'izumi-profile:profile-kid:mal-refresh', 'mal-refresh', 'nuvio-auth-tokens-v1', 'stremio-addon-urls'],
      notes: [expect.stringContaining('proxy username and password were left out')],
    })
  })

  it('exports sign-ins with secrets, but never this device\'s identity or session state', () => {
    const backup = createBackup(storageWith(SNAPSHOT), true)
    expect(backup.localStorage['debrid-key']).toBe('"LEAK-debrid-0123456789"')
    expect(backup.localStorage['izumi-profile:profile-kid:mal-refresh']).toBe('"LEAK-mal-refresh-kid"')
    expect(backup.localStorage['torrent-proxy-url']).toContain('LEAK-proxy-password')
    expect(backup.localStorage.downloads).toContain('LEAK-link-0123')
    expect(backup.localStorage['dead-sources-v6']).toContain('LEAK-config-0123456789')
    const exported = Object.keys(backup.localStorage)
    for (const key of ['cloudflare-sync-config-v1', 'cloudflare-sync-setup-secret-v1', 'paired-tizen-companions-v1', 'izumi-active-profile-v1', 'izumi-profile:profile-kid:trakt-browser-auth-v1']) {
      expect(exported).not.toContain(key)
    }
    expect(backup.redacted).toEqual({ keys: [], notes: [] })
  })

  it('applies the same policy to any key/value snapshot', () => {
    const backup = createBackupFromEntries({ 'ui-scale': '1.2', 'subdl-api-key': '"k"', 'watch-party-device-id-v1': '"d"' }, false)
    expect(backup.version).toBe(1)
    expect(backup.localStorage).toEqual({ 'ui-scale': '1.2' })
    expect(backup.redacted).toEqual({ keys: ['subdl-api-key'], notes: [] })
  })

  it('keeps the watch history and library, replacing only the secret text inside them', () => {
    const history = JSON.stringify({ '21:1': { media: { id: 21, title: 'Show', stream: 'https://addon.test/LEAK-config-0123456789/stream/1.json' }, progress: 0.5 } })
    const library = JSON.stringify({ entries: { '21': { note: 'LEAK-config-0123456789' } }, lists: [] })
    const backup = createBackupFromEntries({
      'stremio-addon-urls': SNAPSHOT['stremio-addon-urls'],
      'local-history': history,
      'izumi-profile:profile-kid:local-media-library-v1': library,
    }, false)
    expect(JSON.stringify(backup)).not.toContain('LEAK')
    expect(backup.localStorage).toEqual({
      'local-history': history.replace('LEAK-config-0123456789', '[redacted]'),
      'izumi-profile:profile-kid:local-media-library-v1': library.replace('LEAK-config-0123456789', '[redacted]'),
    })
    expect(backup.redacted).toEqual({ keys: ['stremio-addon-urls'], notes: [expect.stringContaining('was replaced with [redacted]')] })
  })

  it('leaves a library collection out when replacing the secret text would break it', () => {
    // The harvested string spans JSON syntax in the library value, so replacing it cannot keep JSON.
    const library = JSON.stringify({ x: 'a', 'b-0123456789': 1 })
    const backup = createBackupFromEntries({ 'debrid-key': JSON.stringify('a","b-0123456789'), 'local-media-library-v1': library }, false)
    expect(backup.localStorage).toEqual({})
    expect(backup.redacted).toEqual({ keys: ['debrid-key', 'local-media-library-v1'], notes: [] })
  })

  it('writes the policy into the saved file', async () => {
    const saved = JSON.parse(await stringifyBackup(storageWith({ 'nav-config-v1': '[]', 'debrid-key': '"k"' }))) as AppBackup
    expect(saved.localStorage).toEqual({ 'nav-config-v1': '[]' })
    expect(saved.redacted).toEqual({ keys: ['debrid-key'], notes: [] })
  })

  it.each([false, true])('round-trips izumi-profiles-v1 with its PIN verifiers (secrets included: %s)', async (includeSecrets) => {
    const file = parseBackup(JSON.stringify(createBackup(storageWith({ 'izumi-profiles-v1': HOUSEHOLD }), includeSecrets)))
    const target = new MemoryStorage()
    await restoreBackup(target, file)
    expect(target.getItem('izumi-profiles-v1')).toBe(HOUSEHOLD)
    expect(target.getItem('izumi-profiles-v1')).toContain('"pin":{"salt":"00ff00ff00ff00ff"')
  })
})

describe('restoring under the storage-key policy', () => {
  const file = (patch: Record<string, unknown>) => JSON.stringify({ app: 'izumi', kind: 'app-backup', version: 1, exportedAt: 1, includesSecrets: false, localStorage: {}, ...patch })

  it('names a newer backup format and rejects anything else', () => {
    expect(() => parseBackup(file({ version: 2 }))).toThrow('This backup was made by a newer version of Izumi.')
    expect(() => parseBackup(file({ app: 'other' }))).toThrow('Not an Izumi app backup.')
    expect(() => parseBackup(file({ version: 0 }))).toThrow('Not an Izumi app backup.')
    expect(() => parseBackup('null')).toThrow('Not an Izumi app backup.')
    expect(() => parseBackup('[]')).toThrow('Not an Izumi app backup.')
    expect(() => parseBackup(file({ localStorage: { 'ui-scale': 1 } }))).toThrow('The backup contains an invalid setting.')
  })

  it('reads the left-out list when present and ignores a malformed one', () => {
    expect(parseBackup(file({ redacted: { keys: ['debrid-key', 7], notes: 'x' } })).redacted).toEqual({ keys: ['debrid-key'], notes: [] })
    expect(parseBackup(file({ redacted: { keys: ['a'], notes: ['b'] } })).redacted).toEqual({ keys: ['a'], notes: ['b'] })
    expect(parseBackup(file({ redacted: { keys: [], notes: ['b', 'b'] } })).redacted).toEqual({ keys: [], notes: ['b'] })
    expect('redacted' in parseBackup(file({}))).toBe(false)
    expect('redacted' in parseBackup(file({ redacted: 'x' }))).toBe(false)
  })

  it('skips secrets, device identity and session state from an older file that says it has no secrets', async () => {
    const storage = new MemoryStorage()
    const backup = parseBackup(file({ localStorage: {
      'nav-config-v1': '[]',
      'izumi-profile:profile-kid:mal-refresh': '"old-leak"',
      'nuvio-auth-tokens-v1': '{"accessToken":"old-leak"}',
      'cloudflare-sync-config-v1': '{"groupKey":"old-leak"}',
      'izumi-active-profile-v1': '"profile-kid"',
      'companion-client-restore-v1': '{"state":"old"}',
    } }))
    expect(await restoreBackup(storage, backup)).toBe(1)
    expect([...storage.values.keys()]).toEqual(['nav-config-v1'])
  })

  it('restores secrets from a file made with them, but never another device\'s identity', async () => {
    const storage = new MemoryStorage()
    const backup = parseBackup(file({ includesSecrets: true, localStorage: {
      'debrid-key': '"key"',
      'paired-tizen-companions-v1': '[]',
      'sync-provider-v1': '"cloudflare"',
      'trakt-browser-auth-v1': '{}',
    } }))
    expect(await restoreBackup(storage, backup)).toBe(1)
    expect([...storage.values.keys()]).toEqual(['debrid-key'])
  })

  it('puts this device\'s download links and proxy sign-in back when the file left them out', async () => {
    const storage = new MemoryStorage()
    storage.setItem('downloads', JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1', url: 'https://local.test/file-1' } }))
    storage.setItem('torrent-proxy-url', '"socks5://me:local-password@127.0.0.1:1080"')
    await restoreBackup(storage, parseBackup(file({ localStorage: {
      downloads: JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1 restored' }, '2:1': { id: '2:1', title: 'Other' } }),
      'torrent-proxy-url': '"socks5://127.0.0.1:1080"',
    } })))
    expect(JSON.parse(storage.getItem('downloads')!)).toEqual({
      '1:1': { id: '1:1', title: 'Episode 1 restored', url: 'https://local.test/file-1' },
      '2:1': { id: '2:1', title: 'Other' },
    })
    expect(storage.getItem('torrent-proxy-url')).toBe('"socks5://me:local-password@127.0.0.1:1080"')
  })

  it('takes the file\'s proxy when it names another proxy', async () => {
    const storage = new MemoryStorage()
    storage.setItem('torrent-proxy-url', '"socks5://me:local-password@127.0.0.1:1080"')
    await restoreBackup(storage, parseBackup(file({ localStorage: { 'torrent-proxy-url': '"socks5://proxy.test:9050"' } })))
    expect(storage.getItem('torrent-proxy-url')).toBe('"socks5://proxy.test:9050"')
  })

  it('rolls every touched key back when a write fails', async () => {
    class FailingStorage extends MemoryStorage {
      failed = false
      setItem(key: string, value: string) {
        if (key === 'home-row-order' && !this.failed) {
          this.failed = true
          throw new Error('Quota exceeded')
        }
        super.setItem(key, value)
      }
    }
    const storage = new FailingStorage()
    storage.setItem('nav-config-v1', '["before"]')
    const backup = parseBackup(file({ localStorage: { 'nav-config-v1': '["after"]', 'home-row-order': '["continue"]' } }))
    await expect(restoreBackup(storage, backup)).rejects.toThrow('Quota exceeded')
    expect(storage.getItem('nav-config-v1')).toBe('["before"]')
    expect(storage.getItem('home-row-order')).toBeNull()
  })
})

describe('backup page redaction copy', () => {
  const page = readFileSync(fileURLToPath(new URL('../routes/app/settings/backup/+page.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  it('tells the user how many settings were left out after saving', () => {
    expect(page).toContain('(JSON.parse(text) as AppBackup).redacted?.keys.length ?? 0')
    expect(page).toContain('settings were left out because they hold a sign-in, key or password.')
    expect(page).toContain('1 setting was left out because it holds a sign-in, key or password.')
    expect(page).toContain('if (saved) message = savedMessage(text)')
  })

  it('lists the left-out keys and the notes in the restore preview', () => {
    expect(page).toContain("import { baseStorageKey } from '$lib/storage/key-policy'")
    expect(page).toContain('{#if pending.redacted && pending.redacted.keys.length > 0}')
    expect(page).toContain('Left out of this file: {leftOutNames(pending.redacted.keys)}')
    expect(page).toContain('{#each pending.redacted?.notes ?? [] as note (note)}')
  })

  it('says this device\'s sync membership and TV pairing never travel in a backup', () => {
    expect(page).toContain("This device's sync membership and TV pairing are never included.")
  })
})

// "Save backup" went through @tauri-apps/plugin-dialog's save(), and the capability file granted
// dialog:allow-open but never dialog:allow-save. Tauri denies an ungranted command at the IPC
// boundary, so EVERY save dialog in the app — the application backup, both watch-history exports,
// and the diagnostics dump — rejected before a file picker could open. The denial arrives as a
// string, which the callers' `instanceof Error` checks discarded, so all the user saw was
// "Backup failed." Nothing about this is visible until someone presses the button, hence a test.
describe('save-dialog capability', () => {
  const capability = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
  ) as { permissions: unknown[] }

  it('grants both halves of the file-dialog plugin', () => {
    expect(capability.permissions).toContain('dialog:allow-open')
    expect(capability.permissions).toContain('dialog:allow-save')
  })
})

// Android's save picker returns a `content://` URI. Writing that with std::fs is
// "os error 2" (ENOENT) because the URI is not a filesystem path. The native write
// primitive has to send those URIs through ContentResolver.openOutputStream so the
// user can put the backup anywhere the system picker allows.
describe('Android backup save', () => {
  const kotlin = readFileSync(
    fileURLToPath(new URL('../../src-tauri/tauri-plugin-extplayer/android/src/main/java/app/izumi/extplayer/ExtPlayerPlugin.kt', import.meta.url)),
    'utf8',
  )
  const helper = readFileSync(
    fileURLToPath(new URL('./player/history-io.ts', import.meta.url)),
    'utf8',
  )

  it('uses the combined SAF command on Android instead of dialog.save plus write_text_file', () => {
    expect(helper).toContain("plugin:extplayer|save_text_file")
    expect(helper).toContain('ACTION_CREATE_DOCUMENT')
  })

  it('writes the picked document through ContentResolver in the activity result', () => {
    expect(kotlin).toContain('ACTION_CREATE_DOCUMENT')
    expect(kotlin).toContain('openOutputStream')
    expect(kotlin).toContain('saveTextFileResult')
  })
})

describe('ioErrorMessage', () => {
  it('surfaces a Tauri string rejection instead of the generic fallback', () => {
    expect(ioErrorMessage('dialog.save not allowed', 'Backup failed.')).toBe('dialog.save not allowed')
    expect(ioErrorMessage(new Error('Disk full'), 'Backup failed.')).toBe('Disk full')
  })

  it('falls back for values that say nothing', () => {
    expect(ioErrorMessage('   ', 'Backup failed.')).toBe('Backup failed.')
    expect(ioErrorMessage(undefined, 'Backup failed.')).toBe('Backup failed.')
    expect(ioErrorMessage(new Error(''), 'Backup failed.')).toBe('Backup failed.')
  })
})

// Restricted profiles need the main PIN for a household backup (spec §6.6). The page asks; these
// functions check the one-shot grant before anything is read or written.
describe('household gate', () => {
  const locked = () => { throw new Error('Enter the main profile PIN first.') }
  const backupOf = (values: Record<string, string>) => parseBackup(JSON.stringify({
    app: 'izumi', kind: 'app-backup', version: 1, exportedAt: 1, includesSecrets: false, localStorage: values,
  }))

  beforeEach(() => {
    gate.assertHouseholdAction.mockReset()
  })

  it('checks the grant before building an export', async () => {
    gate.assertHouseholdAction.mockImplementation(locked)
    const storage = new MemoryStorage()
    storage.setItem('nav-config-v1', '[]')
    await expect(stringifyBackup(storage)).rejects.toThrow('Enter the main profile PIN first.')
    expect(gate.assertHouseholdAction).toHaveBeenCalledWith('backup-export')
  })

  it('checks the grant before touching storage on restore', async () => {
    gate.assertHouseholdAction.mockImplementation(locked)
    const storage = new MemoryStorage()
    storage.setItem('home-row-order', '["old"]')
    await expect(restoreBackup(storage, backupOf({ 'home-row-order': '["new"]' }))).rejects.toThrow('Enter the main profile PIN first.')
    expect(storage.getItem('home-row-order')).toBe('["old"]')
    expect(gate.assertHouseholdAction).toHaveBeenCalledWith('backup-restore')
  })

  it('exports and restores once the grant is there', async () => {
    const source = new MemoryStorage()
    source.setItem('nav-config-v1', '[]')
    const text = await stringifyBackup(source)
    expect(JSON.parse(text).localStorage['nav-config-v1']).toBe('[]')
    const target = new MemoryStorage()
    expect(await restoreBackup(target, backupOf({ 'home-row-order': '["continue"]' }))).toBe(1)
    expect(target.getItem('home-row-order')).toBe('["continue"]')
    expect(gate.assertHouseholdAction.mock.calls).toEqual([['backup-export'], ['backup-restore']])
  })
})
